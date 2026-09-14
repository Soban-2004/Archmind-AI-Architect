import json
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.prompts import RETRY_SUFFIX
from app.llm.rest_client import post_chat_completion
from app.models.commands import InterviewTurnOutput

MAX_RETRIES = 3
BASE_URL = "https://openrouter.ai/api/v1"
T = TypeVar("T", bound=BaseModel)


class OpenRouterProvider(LLMProvider):
    """A genuinely different shape of free tier than Groq/Cerebras: no
    token-per-minute ceiling at all on `:free`-suffixed models, only a
    request-rate limit (20 RPM / 200 RPD as of when this was added — see
    llm/factory.py's own comment for the fuller comparison). Confirmed no
    credit card required before adding this, same discipline as every
    other provider added this session.

    settings.openrouter_model is NOT the same gpt-oss-120b model Groq/
    Cerebras use — that :free variant was pulled from OpenRouter within
    the same session this provider was added in (a real, live "model
    unavailable for free" response), confirming the free-model roster
    really does churn the way OpenRouter's own docs warn. The current
    default was chosen by querying GET /models for this account's
    actual live free list and testing the result against a real
    structured-JSON call — expect to need to update it again; that's
    exactly why it's a plain env var, not hardcoded."""

    def __init__(self) -> None:
        self.last_usage: dict[str, int] | None = None

    async def _json_completion(self, messages: list[dict], schema_model: type[T], seed_error: str | None = None) -> T:
        last_error = seed_error

        for _attempt in range(MAX_RETRIES):
            turn_messages = list(messages)
            if last_error:
                turn_messages.append({"role": "user", "content": RETRY_SUFFIX.format(errors=last_error)})

            # A RestAPIError (rate limit, auth, server error — anything
            # the REST call itself rejected) is deliberately NOT caught
            # here: resending the same request with a "fix your JSON"
            # note doesn't fix a 429/500, it just wastes an attempt — let
            # it propagate straight out so FallbackProvider moves on to
            # the next provider in the chain instead.
            data = await post_chat_completion(BASE_URL, settings.openrouter_api_key, settings.openrouter_model, turn_messages)

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
