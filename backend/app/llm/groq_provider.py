import json
from typing import TypeVar

from groq import APIStatusError, AsyncGroq
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.prompts import RETRY_SUFFIX
from app.models.commands import InterviewTurnOutput

MAX_RETRIES = 3
T = TypeVar("T", bound=BaseModel)


class GroqProvider(LLMProvider):
    def __init__(self) -> None:
        self._client = AsyncGroq(api_key=settings.groq_api_key)
        # Real usage (from the API response itself, not an estimate) for
        # whatever call most recently completed — read by interview.py
        # right after calling interview_turn() to surface it to the user.
        # An instance attribute rather than a return-value change so the
        # shared LLMProvider interface (structured_json, used as-is by
        # compare.py/analyzer.py) doesn't have to change shape for callers
        # that don't care about usage.
        self.last_usage: dict[str, int] | None = None

    async def _json_completion(self, messages: list[dict], schema_model: type[T], seed_error: str | None = None) -> T:
        last_error = seed_error

        for _attempt in range(MAX_RETRIES):
            turn_messages = list(messages)
            if last_error:
                turn_messages.append({"role": "user", "content": RETRY_SUFFIX.format(errors=last_error)})

            try:
                resp = await self._client.chat.completions.create(
                    model=settings.groq_model,
                    messages=turn_messages,
                    response_format={"type": "json_object"},
                    temperature=0.3,
                )
            except APIStatusError as e:
                # Groq's own server-side json_object validator can reject a
                # malformed generation before we ever see a response body —
                # e.g. json_validate_failed when the model emits plain text
                # instead of JSON. That's the same class of retryable
                # problem as our own json.loads/model_validate failures
                # below, just raised one layer earlier, so feed it back
                # through the identical retry path instead of letting it
                # escape as an unhandled 400.
                body = e.body if isinstance(e.body, dict) else {}
                inner = body.get("error", {}) if isinstance(body, dict) else {}
                last_error = inner.get("message") or str(e)
                continue
            if resp.usage:
                self.last_usage = {
                    "prompt_tokens": resp.usage.prompt_tokens,
                    "completion_tokens": resp.usage.completion_tokens,
                    "total_tokens": resp.usage.total_tokens,
                }
            raw = resp.choices[0].message.content

            try:
                parsed = json.loads(raw)
                return schema_model.model_validate(parsed)
            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                continue

        raise RuntimeError(f"LLM failed to produce valid {schema_model.__name__} after {MAX_RETRIES} attempts: {last_error}")

    async def interview_turn(
        self,
        system_prompt: str,
        conversation: list[dict],
        retry_note: str | None = None,
    ) -> InterviewTurnOutput:
        messages = [{"role": "system", "content": system_prompt}, *conversation]
        return await self._json_completion(messages, InterviewTurnOutput, seed_error=retry_note)

    async def structured_json(self, system_prompt: str, user_message: str, schema_model: type[T]) -> T:
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_message}]
        return await self._json_completion(messages, schema_model)
