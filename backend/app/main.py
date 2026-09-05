from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import analyzer, chat, compare, projects, simulation
from app.config import settings
from app.db.client import close_pool, get_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()  # fail fast on bad SUPABASE_DB_URL instead of on first request
    yield
    await close_pool()


app = FastAPI(title="AI Architect", lifespan=lifespan)

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


@app.get("/health")
async def health():
    return {"status": "ok"}
