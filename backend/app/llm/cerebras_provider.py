import json
from typing import TypeVar

from cerebras.cloud.sdk import APIStatusError, AsyncCerebras
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.prompts import RETRY_SUFFIX
from app.models.commands import InterviewTurnOutput

MAX_RETRIES = 3
T = TypeVar("T", bound=BaseModel)


class CerebrasProvider(LLMProvider):
    """Same real-world shape as GroqProvider (Cerebras's API is deliberately
    OpenAI-client-compatible, and its response/exception field names are
    byte-for-byte identical to Groq's — confirmed by inspecting the actual
    installed SDK before writing this, not assumed), so this mirrors that
    file's logic closely rather than diverging for no reason: same
    retry-on-invalid-JSON loop, same retry-on-json_validate_failed catch
    (Cerebras's json_object mode can reject a malformed generation
    server-side exactly like Groq's does — same class of retryable
    problem, same fix). The whole reason this provider exists: Cerebras's
    free trial serves the SAME model (gpt-oss-120b) at 30K TPM against
    Groq's 8K — see llm/factory.py for how the two are combined (Cerebras
    primary, Groq as a resilience fallback, not a replacement)."""

    def __init__(self) -> None:
        self._client = AsyncCerebras(api_key=settings.cerebras_api_key)
        # Same reasoning as GroqProvider.last_usage — real usage from the
        # API response itself, read by interview.py right after a call.
        self.last_usage: dict[str, int] | None = None

    async def _json_completion(self, messages: list[dict], schema_model: type[T], seed_error: str | None = None) -> T:
        last_error = seed_error

        for _attempt in range(MAX_RETRIES):
            turn_messages = list(messages)
            if last_error:
                turn_messages.append({"role": "user", "content": RETRY_SUFFIX.format(errors=last_error)})

            try:
                resp = await self._client.chat.completions.create(
                    model=settings.cerebras_model,
                    messages=turn_messages,
                    response_format={"type": "json_object"},
                    temperature=0.3,
                )
            except APIStatusError as e:
                # Same server-side json_object rejection GroqProvider
                # guards against (see its own comment) — a malformed
                # generation can be rejected before any response body
                # exists at all, one layer above the json.loads/
                # model_validate try/except below.
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
