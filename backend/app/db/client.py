import json

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    # auto encode/decode jsonb <-> python dict so callers never json.loads/dumps
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not settings.supabase_db_url:
            raise RuntimeError(
                "SUPABASE_DB_URL is not set. Copy backend/.env.example to backend/.env "
                "and fill in your Supabase connection string."
            )
        _pool = await asyncpg.create_pool(
            settings.supabase_db_url,
            init=_init_connection,
            min_size=1,
            max_size=5,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
