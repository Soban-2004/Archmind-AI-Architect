"""
Offline tests for the deterministic half of Phase 5 ingestion — file
discovery and static extraction (services/ingestion_discovery.py,
services/ingestion_extract.py). No LLM call anywhere in this file; the
LLM reconstruction step (services/ingestion.py's reconstruct_architecture)
is exercised live against a real sample project instead (see README) —
that part fundamentally needs a real model call to test meaningfully, the
same reasoning already applied to every other LLM-facing path in this
codebase.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.ingestion_discovery import discover_files
from app.services.ingestion_extract import extract_evidence


def _write(root: Path, rel_path: str, content: str) -> None:
    path = root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.fixture
def sample_repo(tmp_path: Path) -> Path:
    _write(tmp_path, "backend/main.py", """\
from fastapi import FastAPI
from backend.db import fetch_user
from backend.cache import get_cached_user

app = FastAPI()

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    return await fetch_user(user_id)

@app.post("/users")
async def create_user(payload: dict):
    return {"created": True}
""")
    _write(tmp_path, "backend/db.py", """\
import os
import asyncpg

DATABASE_URL = os.getenv("DATABASE_URL")

async def fetch_user(user_id: int):
    pass
""")
    _write(tmp_path, "backend/cache.py", """\
import redis.asyncio as redis

_client = redis.from_url("redis://cache:6379")
""")
    _write(tmp_path, "docker-compose.yml", """\
services:
  backend:
    build: ./backend
    depends_on:
      - db
      - cache
  db:
    image: postgres:16
  cache:
    image: redis:7
""")
    # Noise that discovery must skip: a vendored dependency, a lockfile,
    # a binary-ish file, and something .gitignore explicitly excludes.
    _write(tmp_path, "node_modules/some_pkg/index.js", "module.exports = {};")
    _write(tmp_path, "package-lock.json", "{}")
    _write(tmp_path, "ignored_dir/secret.py", "import os")
    _write(tmp_path, ".gitignore", "ignored_dir/\n")
    return tmp_path


def test_discover_files_skips_vendored_and_gitignored(sample_repo: Path):
    files = discover_files(sample_repo)
    rel_paths = {f.rel_path for f in files}

    assert "backend/main.py" in rel_paths
    assert "backend/db.py" in rel_paths
    assert "backend/cache.py" in rel_paths
    assert "docker-compose.yml" in rel_paths

    assert not any(p.startswith("node_modules/") for p in rel_paths)
    assert "package-lock.json" not in rel_paths
    assert not any(p.startswith("ignored_dir/") for p in rel_paths)


def test_extract_evidence_finds_real_facts_with_correct_sources(sample_repo: Path):
    files = discover_files(sample_repo)
    evidence, unsupported = extract_evidence(files)
    facts = {(e.fact, e.source) for e in evidence}

    assert ("redis_dependency", "backend/cache.py:1") in facts
    assert ("postgres_dependency", "backend/db.py:2") in facts
    assert ("web_framework", "backend/main.py:1") in facts
    assert any(e.fact == "rest_route" and "GET /users/{user_id}" in e.detail for e in evidence)
    assert any(e.fact == "rest_route" and "POST /users" in e.detail for e in evidence)
    assert any(e.fact == "env_var_usage" and "DATABASE_URL" in e.detail for e in evidence)

    # docker-compose: both services present, plus their images correctly
    # mapped to the same db/cache facts the code-level imports produced.
    assert any(e.fact == "docker_service" and "`db`" in e.detail for e in evidence)
    assert any(e.fact == "docker_service" and "`cache`" in e.detail for e in evidence)
    assert any(e.fact == "postgres_dependency" and "docker-compose" in e.detail for e in evidence)
    assert any(e.fact == "redis_dependency" and "docker-compose" in e.detail for e in evidence)
    assert any(e.fact == "docker_depends_on" and "'db'" in e.detail and "'cache'" in e.detail for e in evidence)

    # every evidence id is unique — citations (models/evidence.py) depend on this
    ids = [e.id for e in evidence]
    assert len(ids) == len(set(ids))


def test_extract_evidence_on_empty_repo_produces_nothing(tmp_path: Path):
    files = discover_files(tmp_path)
    assert files == []
    evidence, unsupported = extract_evidence(files)
    assert evidence == []


def test_python_syntax_error_reported_not_crashed(tmp_path: Path):
    _write(tmp_path, "broken.py", "def f(:\n    pass")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert any(e.fact == "unparsed_file" for e in evidence)
