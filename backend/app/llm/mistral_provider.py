import json
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.prompts import RETRY_SUFFIX
from app.llm.rest_client import post_chat_completion
from app.models.commands import InterviewTurnOutput

MAX_RETRIES = 3
BASE_URL = "https://api.mistral.ai/v1"
T = TypeVar("T", bound=BaseModel)


class MistralProvider(LLMProvider):
    """Last in the fallback chain (see llm/factory.py), not first: Mistral's
    free "Experiment" tier gives a real 1B tokens/month, but only 1 request/
    second — real bottleneck for an interactive chat, versus OpenRouter's
    request-based limits being far more forgiving in practice. Genuinely
    free, no card (phone-verified account only, confirmed before adding
    this) — a real third safety net, just not where most traffic should
    ever actually land."""

    def __init__(self) -> None:
        self.last_usage: dict[str, int] | None = None

    async def _json_completion(self, messages: list[dict], schema_model: type[T], seed_error: str | None = None) -> T:
        last_error = seed_error

        for _attempt in range(MAX_RETRIES):
            turn_messages = list(messages)
            if last_error:
                turn_messages.append({"role": "user", "content": RETRY_SUFFIX.format(errors=last_error)})

            # Same reasoning as OpenRouterProvider: a RestAPIError isn't
            # retried here, it propagates so FallbackProvider can move on.
            data = await post_chat_completion(BASE_URL, settings.mistral_api_key, settings.mistral_model, turn_messages)

            usage = data.get("usage") or {}
            if usage:
                self.last_usage = {
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
                }
            raw = data["choices"][0]["message"]["content"]

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
