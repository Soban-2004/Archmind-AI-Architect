import json
from typing import TypeVar

from groq import AsyncGroq
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

    async def _json_completion(self, messages: list[dict], schema_model: type[T], seed_error: str | None = None) -> T:
        last_error = seed_error

        for _attempt in range(MAX_RETRIES):
            turn_messages = list(messages)
            if last_error:
                turn_messages.append({"role": "user", "content": RETRY_SUFFIX.format(errors=last_error)})

            resp = await self._client.chat.completions.create(
                model=settings.groq_model,
                messages=turn_messages,
                response_format={"type": "json_object"},
                temperature=0.3,
            )
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
