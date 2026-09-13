import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    supabase_db_url: str = os.environ.get("SUPABASE_DB_URL", "")
    groq_api_key: str = os.environ.get("GROQ_API_KEY", "")
    groq_model: str = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
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
