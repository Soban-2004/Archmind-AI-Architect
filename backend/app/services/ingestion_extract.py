"""
Static extraction (spec §6 Phase 5, pipeline step 2): per-file, per-
language extraction of discrete facts, feeding step 3's Evidence Graph.
MVP language/infra coverage only (spec): Python, JavaScript/TypeScript,
Docker Compose. Every extractor returns Evidence directly (models/
evidence.py) — never prose, never a summary, always a fact + its exact
source location, so a reconstructed node can always be traced back to a
real line in the real repo.

Deliberately pattern-based, not full static analysis: Python uses the
stdlib `ast` module (a real parser, not regex, so it doesn't get fooled
by a comment or a string that happens to look like an import) for
imports/routes/env-vars; JS/TS uses regex over source text (spec's own
framing is "communication detectable via CODE PATTERNS" — patterns, not
a full parser, and pulling in a JS parser is real dependency weight this
MVP doesn't need yet). Docker Compose is real YAML, parsed as such.
"""
from __future__ import annotations

import ast
import re
from itertools import count
from pathlib import Path
from typing import Iterator

import yaml

from app.models.evidence import Evidence
from app.services.ingestion_discovery import DiscoveredFile

# ---------------------------------------------------------------------------
# Known dependency -> infra/db signal. Conservative on purpose: an ORM like
# SQLAlchemy alone doesn't say WHICH database, so it's tagged generically
# unless a specific driver (psycopg2/asyncpg, pymysql) is also present —
# guessing the wrong engine is worse than saying "sql, engine unspecified"
# and letting the LLM reasoning step (services/ingestion.py) note the gap.
# ---------------------------------------------------------------------------

_PY_DB_IMPORTS = {
    "redis": ("redis_dependency", "keyvalue store (Redis)"),
    "aioredis": ("redis_dependency", "keyvalue store (Redis, async client)"),
    "psycopg2": ("postgres_dependency", "PostgreSQL driver (psycopg2)"),
    "asyncpg": ("postgres_dependency", "PostgreSQL driver (asyncpg)"),
    "pymongo": ("mongo_dependency", "MongoDB driver (pymongo)"),
    "motor": ("mongo_dependency", "MongoDB driver (motor, async)"),
    "pymysql": ("mysql_dependency", "MySQL driver (PyMySQL)"),
    "mysqlclient": ("mysql_dependency", "MySQL driver (mysqlclient)"),
    "sqlalchemy": ("sql_orm_dependency", "SQL ORM (SQLAlchemy) — specific engine not determined from this import alone"),
}
_PY_QUEUE_IMPORTS = {
    "pika": "AMQP client (pika) — likely RabbitMQ",
    "kombu": "messaging library (kombu) — likely Celery/RabbitMQ",
    "celery": "task queue (Celery)",
}
_PY_WEB_FRAMEWORK_IMPORTS = {
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
}

_JS_DB_IMPORTS = {
    "redis": ("redis_dependency", "keyvalue store (Redis)"),
    "ioredis": ("redis_dependency", "keyvalue store (Redis, ioredis client)"),
    "pg": ("postgres_dependency", "PostgreSQL driver (node-postgres)"),
    "mongoose": ("mongo_dependency", "MongoDB ODM (mongoose)"),
    "mongodb": ("mongo_dependency", "MongoDB driver"),
    "mysql": ("mysql_dependency", "MySQL driver"),
    "mysql2": ("mysql_dependency", "MySQL driver (mysql2)"),
}
_JS_QUEUE_IMPORTS = {
    "amqplib": "AMQP client (amqplib) — likely RabbitMQ",
    "bullmq": "job queue (BullMQ, Redis-backed)",
    "bull": "job queue (Bull, Redis-backed)",
}
_JS_WEB_FRAMEWORK_IMPORTS = {
    "express": "Express",
    "fastify": "Fastify",
    "next": "Next.js",
    "koa": "Koa",
}

# Docker Compose image name -> (fact, human label), matched as a prefix
# against the image string before any tag (postgres:16 -> postgres).
_COMPOSE_IMAGE_PREFIXES = {
    "postgres": ("postgres_dependency", "PostgreSQL (docker-compose service)"),
    "redis": ("redis_dependency", "Redis (docker-compose service)"),
    "mongo": ("mongo_dependency", "MongoDB (docker-compose service)"),
    "mysql": ("mysql_dependency", "MySQL (docker-compose service)"),
    "mariadb": ("mysql_dependency", "MariaDB (docker-compose service)"),
    "rabbitmq": ("queue_dependency", "RabbitMQ (docker-compose service)"),
}

_ROUTE_METHODS = {"get", "post", "put", "delete", "patch"}


class _IdGen:
    """Small stable-id allocator for Evidence — 'ev_1', 'ev_2', ... in
    the order evidence is produced, so citations (models/evidence.py's
    IngestionTurnOutput.citations) have something short and stable to
    reference instead of repeating full source strings."""

    def __init__(self) -> None:
        self._counter = count(1)

    def next(self) -> str:
        return f"ev_{next(self._counter)}"


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None


def _extract_python(file: DiscoveredFile, ids: _IdGen) -> Iterator[Evidence]:
    text = _read_text(file.path)
    if text is None:
        return
    try:
        tree = ast.parse(text, filename=file.rel_path)
    except SyntaxError:
        yield Evidence(id=ids.next(), fact="unparsed_file", detail="Python file has a syntax error, skipped", source=file.rel_path)
        return

    seen_top_level_imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            module = node.module if isinstance(node, ast.ImportFrom) else None
            names = [module] if module else [alias.name for alias in node.names]
            for name in names:
                if not name:
                    continue
                top = name.split(".")[0]
                if top in seen_top_level_imports:
                    continue
                seen_top_level_imports.add(top)
                source = f"{file.rel_path}:{node.lineno}"
                if top in _PY_DB_IMPORTS:
                    fact, detail = _PY_DB_IMPORTS[top]
                    yield Evidence(id=ids.next(), fact=fact, detail=f"{detail} — `import {top}`", source=source)
                elif top in _PY_QUEUE_IMPORTS:
                    yield Evidence(id=ids.next(), fact="queue_dependency", detail=f"{_PY_QUEUE_IMPORTS[top]} — `import {top}`", source=source)
                elif top in _PY_WEB_FRAMEWORK_IMPORTS:
                    yield Evidence(id=ids.next(), fact="web_framework", detail=f"{_PY_WEB_FRAMEWORK_IMPORTS[top]} — `import {top}`", source=source)

        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute):
                    continue
                method = dec.func.attr.lower()
                if method not in _ROUTE_METHODS:
                    continue
                path_arg = ""
                if dec.args and isinstance(dec.args[0], ast.Constant) and isinstance(dec.args[0].value, str):
                    path_arg = dec.args[0].value
                yield Evidence(
                    id=ids.next(), fact="rest_route",
                    detail=f"{method.upper()} {path_arg or '(path not a literal)'} -> {node.name}()",
                    source=f"{file.rel_path}:{node.lineno}",
                )

        elif isinstance(node, ast.Call):
            # os.environ.get(...) / os.getenv(...)
            if isinstance(node.func, ast.Attribute) and node.func.attr in ("get", "getenv"):
                target = node.func.value
                is_environ_get = isinstance(target, ast.Attribute) and target.attr == "environ"
                is_os_getenv = isinstance(node.func.value, ast.Name) and node.func.value.id == "os" and node.func.attr == "getenv"
                if is_environ_get or is_os_getenv:
                    if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                        yield Evidence(
                            id=ids.next(), fact="env_var_usage",
                            detail=f"reads env var `{node.args[0].value}`",
                            source=f"{file.rel_path}:{node.lineno}",
                        )


_JS_IMPORT_RE = re.compile(r"""(?:import\s+.*?\s+from\s+|require\()\s*['"]([^'"]+)['"]""")
_JS_ROUTE_RE = re.compile(r"""\b\w+\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]""")


def _extract_js(file: DiscoveredFile, ids: _IdGen) -> Iterator[Evidence]:
    text = _read_text(file.path)
    if text is None:
        return

    seen_imports: set[str] = set()
    for lineno, line in enumerate(text.splitlines(), start=1):
        for m in _JS_IMPORT_RE.finditer(line):
            module = m.group(1)
            top = module.split("/")[0] if not module.startswith(".") else None
            if not top or top in seen_imports:
                continue
            seen_imports.add(top)
            source = f"{file.rel_path}:{lineno}"
            if top in _JS_DB_IMPORTS:
                fact, detail = _JS_DB_IMPORTS[top]
                yield Evidence(id=ids.next(), fact=fact, detail=f"{detail} — `import ... from '{module}'`", source=source)
            elif top in _JS_QUEUE_IMPORTS:
                yield Evidence(id=ids.next(), fact="queue_dependency", detail=f"{_JS_QUEUE_IMPORTS[top]} — `import ... from '{module}'`", source=source)
            elif top in _JS_WEB_FRAMEWORK_IMPORTS:
                yield Evidence(id=ids.next(), fact="web_framework", detail=f"{_JS_WEB_FRAMEWORK_IMPORTS[top]} — `import ... from '{module}'`", source=source)

        for m in _JS_ROUTE_RE.finditer(line):
            method, route_path = m.group(1), m.group(2)
            yield Evidence(id=ids.next(), fact="rest_route", detail=f"{method.upper()} {route_path}", source=f"{file.rel_path}:{lineno}")


def _extract_docker_compose(file: DiscoveredFile, ids: _IdGen) -> Iterator[Evidence]:
    text = _read_text(file.path)
    if text is None:
        return
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError:
        yield Evidence(id=ids.next(), fact="unparsed_file", detail="docker-compose file has invalid YAML, skipped", source=file.rel_path)
        return
    if not isinstance(doc, dict):
        return

    services = doc.get("services")
    if not isinstance(services, dict):
        return

    for service_name, service_def in services.items():
        if not isinstance(service_def, dict):
            continue
        image = service_def.get("image")
        matched = False
        if isinstance(image, str):
            image_base = image.split(":")[0].split("/")[-1]
            for prefix, (fact, label) in _COMPOSE_IMAGE_PREFIXES.items():
                if prefix in image_base:
                    yield Evidence(id=ids.next(), fact=fact, detail=f"{label} — service `{service_name}` (image `{image}`)", source=file.rel_path)
                    matched = True
                    break
        yield Evidence(
            id=ids.next(), fact="docker_service",
            detail=f"docker-compose service `{service_name}`" + (f" (image `{image}`)" if image and not matched else ""),
            source=file.rel_path,
        )
        depends_on = service_def.get("depends_on")
        if isinstance(depends_on, (list, dict)):
            deps = list(depends_on)
            if deps:
                yield Evidence(id=ids.next(), fact="docker_depends_on", detail=f"service `{service_name}` depends_on {deps}", source=file.rel_path)


def is_docker_compose_file(file: DiscoveredFile) -> bool:
    name = file.path.name.lower()
    return name in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")


def extract_evidence(files: list[DiscoveredFile]) -> tuple[list[Evidence], list[str]]:
    """Runs the right extractor per file based on extension, in one pass.
    Returns (evidence, unsupported_notes) — a file this pipeline can't
    meaningfully parse (an unrecognized extension already filtered out by
    discovery, or a language outside MVP coverage encountered as a
    Dockerfile/compose sibling) is noted, never silently dropped."""
    ids = _IdGen()
    evidence: list[Evidence] = []
    unsupported: list[str] = []

    for file in files:
        if is_docker_compose_file(file):
            evidence.extend(_extract_docker_compose(file, ids))
        elif file.extension == ".py":
            evidence.extend(_extract_python(file, ids))
        elif file.extension in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
            evidence.extend(_extract_js(file, ids))
        elif file.extension in (".yml", ".yaml"):
            continue  # a non-compose YAML file (CI config, k8s manifest, ...) carries no MVP-scoped signal today
        elif file.path.name == "Dockerfile" or file.path.name.startswith("Dockerfile."):
            evidence.append(Evidence(id=ids.next(), fact="dockerfile_present", detail="Dockerfile present — this service is containerized", source=file.rel_path))
        # .env / .env.example are intentionally not read for values (secrets), only
        # their presence is weak evidence of externally-configured dependencies —
        # the per-file env var NAMES already come from real code via env_var_usage.

    return evidence, unsupported
