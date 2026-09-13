import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.routes import analyzer, chat, compare, ingestion, migration, projects, simulation
from app.config import settings
from app.db.client import close_pool, get_pool
from app.rate_limit import limiter

# INFO so the judge pass's verdicts (services/interview.py) are actually
# visible — Python's root logger defaults to WARNING, which would
# otherwise silently swallow them.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()  # fail fast on bad SUPABASE_DB_URL instead of on first request
    yield
    await close_pool()


app = FastAPI(title="AI Architect", lifespan=lifespan)

# Per-IP rate limiting (see rate_limit.py) — this app is guest-mode-only
# with no auth, so every endpoint is reachable by anyone. The exception
# handler turns a limit hit into a real 429 with a Retry-After header
# (slowapi's own default handler), not a silent failure or a 500.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(chat.router)
app.include_router(compare.router)
app.include_router(analyzer.router)
app.include_router(simulation.router)
app.include_router(ingestion.router)
app.include_router(migration.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
