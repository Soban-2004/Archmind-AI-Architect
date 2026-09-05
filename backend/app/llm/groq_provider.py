import json

from groq import AsyncGroq
from pydantic import ValidationError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.prompts import RETRY_SUFFIX
from app.models.commands import InterviewTurnOutput

MAX_RETRIES = 3


class GroqProvider(LLMProvider):
    def __init__(self) -> None:
        self._client = AsyncGroq(api_key=settings.groq_api_key)

    async def interview_turn(
        self,
        system_prompt: str,
        conversation: list[dict],
        retry_note: str | None = None,
    ) -> InterviewTurnOutput:
        messages = [{"role": "system", "content": system_prompt}, *conversation]
        last_error = retry_note

        for attempt in range(MAX_RETRIES):
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
                return InterviewTurnOutput.model_validate(parsed)
            except (json.JSONDecodeError, ValidationError) as e:
                last_error = str(e)
                continue

        raise RuntimeError(f"LLM failed to produce valid InterviewTurnOutput after {MAX_RETRIES} attempts: {last_error}")
