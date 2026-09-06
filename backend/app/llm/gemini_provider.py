import json
from typing import TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.prompts import RETRY_SUFFIX
from app.models.commands import InterviewTurnOutput

MAX_RETRIES = 3
T = TypeVar("T", bound=BaseModel)


class GeminiProvider(LLMProvider):
    """A second, independent LLMProvider implementation — used today only
    as the judge pass (services/interview.py), never as the architect
    itself, but implements the full interface (not just structured_json)
    so it's a genuinely swappable provider per the abstraction's own
    intent (see llm/factory.py), not a judge-only special case."""

    def __init__(self) -> None:
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self.last_usage: dict[str, int] | None = None

    async def _json_completion(self, system_prompt: str, user_content: str, schema_model: type[T]) -> T:
        last_error: str | None = None

        for _attempt in range(MAX_RETRIES):
            prompt = system_prompt
            if last_error:
                prompt += RETRY_SUFFIX.format(errors=last_error)

            resp = await self._client.aio.models.generate_content(
                model=settings.gemini_model,
                contents=f"{prompt}\n\n{user_content}",
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            usage = resp.usage_metadata
            if usage:
                self.last_usage = {
                    "prompt_tokens": usage.prompt_token_count or 0,
                    "completion_tokens": usage.candidates_token_count or 0,
                    "total_tokens": usage.total_token_count or 0,
                }

            try:
                parsed = json.loads(resp.text)
                return schema_model.model_validate(parsed)
            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                continue

        raise RuntimeError(f"Gemini failed to produce valid {schema_model.__name__} after {MAX_RETRIES} attempts: {last_error}")

    async def interview_turn(self, system_prompt: str, conversation: list[dict], retry_note: str | None = None) -> InterviewTurnOutput:
        transcript = "\n".join(f"{m['role']}: {m['content']}" for m in conversation)
        prompt = system_prompt
        if retry_note:
            prompt += RETRY_SUFFIX.format(errors=retry_note)
        return await self._json_completion(prompt, transcript, InterviewTurnOutput)

    async def structured_json(self, system_prompt: str, user_message: str, schema_model: type[T]) -> T:
        return await self._json_completion(system_prompt, user_message, schema_model)
