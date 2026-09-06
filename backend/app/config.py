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
    gemini_model: str = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
    cors_origins: list[str] = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")


settings = Settings()
