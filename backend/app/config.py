import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    supabase_db_url: str = os.environ.get("SUPABASE_DB_URL", "")
    groq_api_key: str = os.environ.get("GROQ_API_KEY", "")
    groq_model: str = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
    cors_origins: list[str] = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")


settings = Settings()
