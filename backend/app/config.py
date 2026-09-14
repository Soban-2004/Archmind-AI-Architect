import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    supabase_db_url: str = os.environ.get("SUPABASE_DB_URL", "")
    groq_api_key: str = os.environ.get("GROQ_API_KEY", "")
    groq_model: str = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
    # Primary architect model (see llm/factory.py) — Cerebras serves the
    # SAME gpt-oss-120b model Groq does, at a real ~4x higher free-tier
    # TPM ceiling (30K vs 8K), confirmed against Cerebras's own rate-limit
    # docs before adding this. Optional: absent CEREBRAS_API_KEY, the
    # factory falls back to Groq alone, unchanged from before this existed
    # — this is additive, not a hard new dependency for anyone running
    # this project without a Cerebras account.
    cerebras_api_key: str = os.environ.get("CEREBRAS_API_KEY", "")
    cerebras_model: str = os.environ.get("CEREBRAS_MODEL", "gpt-oss-120b")
    # Two more optional links in the fallback chain (see llm/factory.py) —
    # both confirmed genuinely free, no card, before being added.
    # OpenRouter's `:free`-suffixed models have NO token-per-minute
    # ceiling at all (just a request-rate limit — 20 RPM/200 RPD as of
    # when this was added), which is a more direct fix for "one request's
    # prompt+state is too big" than a higher-but-still-finite TPM number
    # would be. The default below is NOT the same gpt-oss-120b model
    # Groq/Cerebras use — that :free variant was pulled within the same
    # session this was added in (confirmed live: a real "model
    # unavailable for free" response), which is exactly the kind of churn
    # OpenRouter's own docs warn free-tier model availability has. Picked
    # by actually querying GET /models for this account's current
    # free-suffixed list and testing the largest one against a real
    # structured-JSON call, not assumed from a doc. Expect to need to
    # update this again — that's why it's a plain env var, not baked into
    # code.
    openrouter_api_key: str = os.environ.get("OPENROUTER_API_KEY", "")
    openrouter_model: str = os.environ.get("OPENROUTER_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free")
    # Mistral's free "Experiment" tier: a real 1B tokens/month, but only
    # 1 request/second — kept last in the chain, a real third safety net
    # rather than somewhere real traffic should normally land.
    mistral_api_key: str = os.environ.get("MISTRAL_API_KEY", "")
    mistral_model: str = os.environ.get("MISTRAL_MODEL", "mistral-small-latest")
    # Judge pass (a second, independent model reviewing the architect's
    # proposed architecture for structural correctness — see
    # services/interview.py) — optional. Absent GEMINI_API_KEY, the judge
    # is simply skipped and the architect's output is used as-is, same as
    # every other LLM-call fallback in this codebase.
    gemini_api_key: str = os.environ.get("GEMINI_API_KEY", "")
    # Free-tier request quotas are scoped per model, not per account/key —
    # confirmed live (see README): a day of judge-pass testing exhausted
    # gemini-3.6-flash's separate 20-requests/day free quota, which
    # silently disabled the judge (a graceful failure, not a crash — see
    # _run_judge) until it reset. gemini-3.5-flash-lite gets its own,
    # completely separate quota bucket, and is arguably the better fit
    # for the judge's actual job anyway — applying a fixed checklist to
    # a small prompt, not open-ended reasoning, so the lite tier's lower
    # latency/cost is a real win with no quality tradeoff worth paying
    # 3.6-flash's larger footprint for.
    gemini_model: str = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
    cors_origins: list[str] = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
    # Scoped web-search grounding for the advisory chat lane only (see
    # services/web_search.py + intent_router.py's needs_web_grounding) —
    # optional, same fallback philosophy as gemini_api_key above: absent
    # TAVILY_API_KEY, search_web() just returns no results and advisory
    # answers fall back to today's existing (already good) behavior.
    tavily_api_key: str = os.environ.get("TAVILY_API_KEY", "")


settings = Settings()
