"""
Static extraction (spec §6 Phase 5, pipeline step 2): per-file, per-
language extraction of discrete facts, feeding step 3's Evidence Graph.
MVP language/infra coverage only (spec): Python, JavaScript/TypeScript,
Docker Compose, SQL migrations. Every extractor returns Evidence directly
(models/evidence.py) — never prose, never a summary, always a fact + its
exact source location, so a reconstructed node can always be traced back
to a real line in the real repo.

Deliberately pattern-based, not full static analysis: Python uses the
stdlib `ast` module (a real parser, not regex, so it doesn't get fooled
by a comment or a string that happens to look like an import) for
imports/routes/env-vars; JS/TS uses regex over source text (spec's own
framing is "communication detectable via CODE PATTERNS" — patterns, not
a full parser, and pulling in a JS parser is real dependency weight this
MVP doesn't need yet). Docker Compose is real YAML, parsed as such. SQL
migration files use a regex for `CREATE TABLE` only (see _extract_sql).

Coverage gaps found and fixed live, testing against a real repo (a
plain Vite+React frontend talking to Supabase): JS/TS import scanning
originally only recognized BACKEND web frameworks (Express, Next.js, ...)
as "this is a service" evidence and backend-run DB drivers (pg, mongoose,
...) as "this has a database" evidence — a backend-as-a-service SDK
(@supabase/supabase-js, firebase) produced neither, and neither did a
plain frontend framework import (react, vue, svelte, @angular) with no
Next.js-style server capability. Both now have their own recognized
import tables and fact types (see _JS_BAAS_IMPORTS,
_JS_FRONTEND_FRAMEWORK_IMPORTS below) instead of being invisible to this
pipeline.

A second pass, digging into the SAME real repo's one already-reconstructed
node, found a call-site-level gap too: its Edge Function called SendGrid
via a raw `fetch('https://api.sendgrid.com/...')` — a real, unambiguous
API call, STRONGER evidence than any import ever is — but nothing here
looked at fetch/axios call arguments at all, only import statements. Now
does, against a curated list of well-known API hostnames (see
_KNOWN_API_HOSTS/_FETCH_OR_AXIOS_URL_RE) — same real gap the earlier
pass would have hit for any repo that calls a third-party API by URL
instead of through its SDK, which is common in serverless/edge functions
specifically (no npm install available, or deliberately avoided for cold-
start size). While digging into that call site, also found and fixed a
related false-positive: `Deno.env.get('SOME_KEY')` matches the exact same
shape as a REST route handler (`router.get(path, ...)`) and was being
misreported as one — see _ROUTE_FALSE_POSITIVE_RECEIVERS.

A third pass, prompted by "what about authentication, and the actual
tables" for that same repo, found: no `supabase.auth.*` usage was
recognized at all (see _SUPABASE_AUTH_RE), and the repo's real table name
existed nowhere but a `.from('voters')` query builder call (see
_SUPABASE_TABLE_RE) — its one SQL migration had zero CREATE TABLE
statements, only RLS policies (`_SQL_TABLE_REFERENCE_RE`, added to
_extract_sql alongside CREATE TABLE).

A fourth pass generalized all of the above PAST that one Supabase-shaped
repo, to any stack: Python gained its own auth-library table
(_PY_AUTH_IMPORTS + a django.contrib.auth special case, since Django's
own auth doesn't fit the top-level-import-segment dict shape every other
table here uses), its own third-party-API-call detection
(`requests`/`httpx` module-level calls, same _KNOWN_API_HOSTS table the
JS/TS fetch/axios check already used), and its own ORM-model-to-table
detection (_classify_python_orm_model — SQLAlchemy's `__tablename__`,
Django's `models.Model`) — this last one matters more than the SQL-
migration path for most real apps, which define schema in code, not
hand-written DDL. JS/TS gained dedicated auth-PROVIDER recognition
(_JS_AUTH_PROVIDER_IMPORTS: NextAuth, Auth0, Passport, Clerk — external
dependencies, not a database, unlike Supabase/Firebase), a `firebase/
auth` submodule-specific check (distinct from the generic
firebase_dependency the bare `firebase` import already produces), and
Mongoose model detection (_MONGOOSE_MODEL_RE).
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
# Auth libraries — the Python-side twin of _JS_AUTH_PROVIDER_IMPORTS/
# _SUPABASE_AUTH_RE below: real, specific evidence a project has actual
# authentication in place (or, by its absence, genuinely might not),
# generalized past this session's one Supabase-shaped test repo. Django's
# own contrib.auth doesn't fit this top-level-segment dict (an import
# like `from django.contrib.auth import authenticate` has top="django",
# already claimed by the web-framework entry above) — handled as its own
# substring check in _extract_python instead, same pattern
# _DENO_EDGE_FUNCTION_MARKER uses for a URL import that can't be a dict
# key either.
_PY_AUTH_IMPORTS = {
    "flask_login": "Flask-Login",
    "flask_jwt_extended": "Flask-JWT-Extended",
    "jwt": "PyJWT",
    "authlib": "Authlib",
    "django_allauth": "django-allauth",
}
_DJANGO_AUTH_MARKER = "django.contrib.auth"

# Real third-party API calls — the Python-side twin of
# _FETCH_OR_AXIOS_URL_RE below, same _KNOWN_API_HOSTS table (defined
# further down, shared by both extractors since it's language-agnostic).
# `requests`/`httpx` module-level calls only (`requests.get(url)`,
# `httpx.post(url)`) — a call through a pre-built client instance
# (`session.get(...)`) would need real data-flow tracking to attribute
# correctly, which this pattern-based pass deliberately doesn't attempt.
_PY_HTTP_CLIENT_MODULES = {"requests", "httpx"}
_PY_HTTP_METHODS = {"get", "post", "put", "delete", "patch"}

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

# Deno's std HTTP server — imported by URL, not an npm package name, so
# it can't go through the top-level-segment dicts above (`top` for
# "https://deno.land/std@0.190.0/http/server.ts" is just "https:"). This
# is THE boilerplate import every Supabase/Deno Deploy Edge Function
# starts with (`import { serve } from "https://deno.land/std.../http/
# server.ts"`) — without recognizing it, a file that's a real, deployed
# service has nothing marking it as one (no npm web-framework import to
# match), which starves the LLM reconstruction step of the one signal
# that would tell it "this IS a service", not just a file that happens to
# make an API call. Found live: exactly this shape (a SendGrid fetch()
# call inside a Deno Edge Function) reconstructed as a correctly-cited
# but completely UNWIRED SendGrid node — a real dependency with nothing
# pointing at it, because nothing said which service calls it.
_DENO_EDGE_FUNCTION_MARKER = "deno.land/std"

# Backend-as-a-service SDKs — genuinely common (arguably THE most common
# backend for a vibe-coded app) and, before this, entirely invisible to
# this pipeline: none of these are a "driver" for a database this project
# runs itself, they're a client for a real, specific managed platform, so
# they get their own dict/fact rather than being folded into
# _JS_DB_IMPORTS above. Found live: a real test repo using
# @supabase/supabase-js produced a citable OTP/SendGrid edge but nothing
# at all for its actual database, because nothing recognized the import
# that's the entire reason the app has a database. Matched on the scoped
# package's first segment ("@supabase") or the bare module name
# ("firebase"), the same top-level-match granularity every other table
# here already uses — a specific submodule (`@supabase/auth-js`,
# `firebase/firestore`) still resolves to the platform as a whole, which
# is honest: this pipeline can see "this project depends on Supabase", not
# reliably WHICH of Supabase's services a given file uses.
_JS_BAAS_IMPORTS = {
    "@supabase": ("supabase_dependency", "Supabase — managed backend platform (Postgres database + Auth + Realtime + Storage)"),
    "firebase": ("firebase_dependency", "Firebase — managed backend platform (Firestore/Realtime Database + Auth), specific service not determined from this import alone"),
}

# Frontend UI framework imports — before this, ONLY Next.js (via
# _JS_WEB_FRAMEWORK_IMPORTS above, because it can also run a server) said
# "this is a frontend" at all; a plain Vite/CRA React, Vue, or Svelte app
# produced zero frontend evidence, full stop. Distinct fact name
# ("frontend_framework", not "web_framework") so the ingestion prompt's
# grounding rules can point the LLM at node_type=service/type=frontend
# specifically, not leave it to guess from a generic "web_framework" label
# that today only ever means a backend server.
_JS_FRONTEND_FRAMEWORK_IMPORTS = {
    "react": "React",
    "react-dom": "React DOM",
    "vue": "Vue",
    "svelte": "Svelte",
    "@angular": "Angular",  # scope-level match, same reasoning as "@supabase" above (@angular/core, @angular/router, ...)
    "solid-js": "SolidJS",
}

# Dedicated auth-as-a-service / auth-library imports — generalizes past
# this session's one Supabase-shaped test repo. Distinct from
# _JS_BAAS_IMPORTS above: these aren't also a database, they're PURELY an
# auth provider, so they map to node_type="external_dependency"/
# type="auth_provider" (see prompts.py's ATTRIBUTE_SHAPE_RULES), not a
# database node the way Supabase/Firebase do.
_JS_AUTH_PROVIDER_IMPORTS = {
    "next-auth": "NextAuth.js",
    "@auth0": "Auth0",
    "passport": "Passport.js",
    "@clerk": "Clerk",
}

# Supabase Auth method calls — real, specific evidence that a project
# uses Supabase's built-in auth (not just its database), which
# `supabase_dependency` alone (an import) can't distinguish: a project
# importing @supabase/supabase-js might use Auth, might use only the
# database, or (found live, testing a real repo) might implement its own
# fully custom auth flow and use Supabase purely as a data store —
# supabase.auth calls are the one thing that actually tells the two apart.
# Curated method names, not a bare `.auth.` match, to avoid matching an
# unrelated `.auth` property on some other object.
_SUPABASE_AUTH_METHODS = (
    "signInWithOtp", "signInWithPassword", "signInWithOAuth", "signUp",
    "signOut", "onAuthStateChange", "getSession", "getUser", "verifyOtp",
    "resetPasswordForEmail", "updateUser",
)
_SUPABASE_AUTH_RE = re.compile(r"""\.auth\.(""" + "|".join(_SUPABASE_AUTH_METHODS) + r""")\s*\(""")

# `.from('table_name')` — a Supabase/PostgREST-style query builder call,
# real evidence of a specific table actually being read/written, often
# the ONLY such evidence that exists: found live, a real repo's one SQL
# migration had no CREATE TABLE at all (the table was created through
# Supabase's dashboard, never committed as a migration) — only
# `supabase.from('voters')` calls in the actual application code named
# the real table. Gated on the file already showing supabase usage
# (`_mentions_supabase` in _extract_js) rather than matched bare: `.from(`
# alone is also `Array.from(...)`/`Buffer.from(...)`, both common and
# both would otherwise misfire as "table usage" for any string-literal
# first argument.
_SUPABASE_TABLE_RE = re.compile(r"""\.from\(\s*['"]([\w.]+)['"]""")

# `mongoose.model('Name', schema)` — Mongoose's own real, unambiguous
# collection-naming call (unlike Supabase's, this one needs no gating
# against a false-positive-prone bare pattern: `mongoose.model(` is
# specific enough on its own). Not scoped to files "mentioning mongoose"
# the way the Supabase table check is, since there's no Array.from/
# Buffer.from-shaped collision to guard against here.
_MONGOOSE_MODEL_RE = re.compile(r"""\bmongoose\.model\(\s*['"]([^'"]+)['"]""")

# A real external API call — `fetch('https://api.sendgrid.com/...')` — is
# STRONGER evidence than any import-based signal above: it's not "this
# project depends on a library that could talk to X", it's the literal
# request URL. Found live: a real repo's OTP function called SendGrid
# through a raw `fetch()` (no SDK import at all, as many Deno/edge
# functions do) — completely invisible to every table above, which only
# ever look at import statements. Curated, not exhaustive (same
# discipline as engines.py/docker_images.py) — an unrecognized host
# produces no evidence rather than a guessed vendor name; recognizing a
# handful of the most common production SaaS APIs is far more valuable
# than trying to be exhaustive here.
_KNOWN_API_HOSTS: dict[str, str] = {
    "api.sendgrid.com": "SendGrid (email delivery)",
    "api.mailgun.net": "Mailgun (email delivery)",
    "api.resend.com": "Resend (email delivery)",
    "api.stripe.com": "Stripe (payments)",
    "api.twilio.com": "Twilio (SMS/voice)",
    "api.openai.com": "OpenAI API",
    "api.anthropic.com": "Anthropic API",
    "api.cloudinary.com": "Cloudinary (media storage)",
    "api.algolia.com": "Algolia (search)",
    "maps.googleapis.com": "Google Maps API",
}

_FETCH_OR_AXIOS_URL_RE = re.compile(r"""\b(?:fetch|axios(?:\.\w+)?)\s*\(\s*['"]([^'"]+)['"]""")

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


def _classify_python_orm_model(node: ast.ClassDef, file: DiscoveredFile, ids: _IdGen) -> Iterator[Evidence]:
    """Real table/collection evidence from an ORM MODEL definition, not a
    raw SQL migration — the biggest remaining stack-coverage gap this
    pipeline had: most real apps declare their schema in code (a
    SQLAlchemy/Django model class), not hand-written CREATE TABLE
    statements, so `_extract_sql` alone was blind to the common case.
    Two conventions recognized by base-class shape, not an exhaustive
    parse of either ORM's real inheritance chains:
    - SQLAlchemy: any base literally named (or ending in) "Base" — the
      near-universal `Base = declarative_base()` / `class Base(DeclarativeBase)`
      convention — or `db.Model` (Flask-SQLAlchemy's own convention). The
      real table name comes from a `__tablename__ = "..."` class
      attribute when present (SQLAlchemy's actual mechanism for it);
      falls back to the class name, honestly labeled as inferred, when
      that attribute is absent.
    - Django: `models.Model` (or a subclass of it) as a base — Django
      auto-derives the table name (`appname_modelname`), so there's no
      real name to extract beyond the class name itself.
    """
    def base_name(base: ast.expr) -> str | None:
        if isinstance(base, ast.Name):
            return base.id
        if isinstance(base, ast.Attribute):
            return f"{base_name(base.value)}.{base.attr}" if isinstance(base.value, (ast.Name, ast.Attribute)) else base.attr
        return None

    bases = [base_name(b) for b in node.bases]
    is_sqlalchemy = any(b and (b == "Base" or b.endswith(".Base") or b.endswith("Base") or b == "db.Model") for b in bases if b)
    is_django = any(b and (b == "models.Model" or b.endswith(".Model")) for b in bases if b)

    if not is_sqlalchemy and not is_django:
        return

    if is_sqlalchemy:
        table_name = None
        for item in node.body:
            if (
                isinstance(item, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "__tablename__" for t in item.targets)
                and isinstance(item.value, ast.Constant)
                and isinstance(item.value.value, str)
            ):
                table_name = item.value.value
                break
        if table_name:
            yield Evidence(id=ids.next(), fact="database_schema", detail=f"table `{table_name}` defined (SQLAlchemy model `{node.name}`, __tablename__)", source=f"{file.rel_path}:{node.lineno}")
        else:
            yield Evidence(id=ids.next(), fact="database_schema", detail=f"SQLAlchemy model `{node.name}` — no __tablename__ declared, real table name not determined from this alone", source=f"{file.rel_path}:{node.lineno}")
    else:
        yield Evidence(id=ids.next(), fact="database_schema", detail=f"Django model `{node.name}` — table name auto-derived by Django, not explicit in code", source=f"{file.rel_path}:{node.lineno}")


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
    seen_django_auth = False
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            module = node.module if isinstance(node, ast.ImportFrom) else None
            names = [module] if module else [alias.name for alias in node.names]
            for name in names:
                if not name:
                    continue
                if _DJANGO_AUTH_MARKER in name and not seen_django_auth:
                    seen_django_auth = True
                    yield Evidence(
                        id=ids.next(), fact="auth_usage",
                        detail=f"Django's built-in auth (django.contrib.auth) — `import {name}`",
                        source=f"{file.rel_path}:{node.lineno}",
                    )
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
                elif top in _PY_AUTH_IMPORTS:
                    yield Evidence(id=ids.next(), fact="auth_usage", detail=f"{_PY_AUTH_IMPORTS[top]} — `import {top}`", source=source)

        elif isinstance(node, ast.ClassDef):
            yield from _classify_python_orm_model(node, file, ids)

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

            # requests.get(url)/httpx.post(url)/... to a known third-party
            # API host — the Python-side twin of _FETCH_OR_AXIOS_URL_RE.
            # Module-level calls only (see _PY_HTTP_CLIENT_MODULES's own
            # comment for why a pre-built client instance isn't attempted).
            if (
                isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id in _PY_HTTP_CLIENT_MODULES
                and node.func.attr in _PY_HTTP_METHODS
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                url = node.args[0].value
                for host, label in _KNOWN_API_HOSTS.items():
                    if host in url:
                        yield Evidence(
                            id=ids.next(), fact="third_party_api_call",
                            detail=f"{label} — real API call to `{url}`",
                            source=f"{file.rel_path}:{node.lineno}",
                        )
                        break


_JS_IMPORT_RE = re.compile(r"""(?:import\s+.*?\s+from\s+|require\()\s*['"]([^'"]+)['"]""")
_JS_ROUTE_RE = re.compile(r"""\b(\w+)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]""")
# `env.get('SOME_KEY')` (Deno's `Deno.env.get(...)`, or any `something.env.get(...)`)
# matches the route pattern's shape exactly but isn't a route at all — found
# live: a real repo's `Deno.env.get('SENDGRID_API_KEY')` was misreported as
# a "GET SENDGRID_API_KEY" REST route. Env var reads already have their own,
# correct fact (env_var_usage, Python-only today) — this is purely a false-
# positive guard, not an attempt to extend env-var detection to JS.
_ROUTE_FALSE_POSITIVE_RECEIVERS = {"env"}


def _extract_js(file: DiscoveredFile, ids: _IdGen) -> Iterator[Evidence]:
    text = _read_text(file.path)
    if text is None:
        return

    # Whole-file check (not per-line — the import establishing this is
    # usually near the top, table/auth usage anywhere below it), used to
    # gate _SUPABASE_TABLE_RE below against Array.from/Buffer.from false
    # positives (see that regex's own comment) — a crude substring check
    # on purpose, cheap and it only needs to rule OUT files that have
    # nothing to do with Supabase at all, not be a precise parse.
    mentions_supabase = "supabase" in text.lower()

    seen_imports: set[str] = set()
    seen_firebase_auth = False
    for lineno, line in enumerate(text.splitlines(), start=1):
        for m in _JS_IMPORT_RE.finditer(line):
            module = m.group(1)

            # `firebase/auth` specifically (not just "firebase" generally)
            # — checked before the top-based dedup below so it still fires
            # even when a `firebase/firestore` (or similar) import already
            # claimed the "firebase" top-level slot in this file.
            if "firebase/auth" in module and not seen_firebase_auth:
                seen_firebase_auth = True
                yield Evidence(id=ids.next(), fact="auth_usage", detail=f"Firebase Auth — `import ... from '{module}'`", source=f"{file.rel_path}:{lineno}")

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
            elif top in _JS_BAAS_IMPORTS:
                fact, detail = _JS_BAAS_IMPORTS[top]
                yield Evidence(id=ids.next(), fact=fact, detail=f"{detail} — `import ... from '{module}'`", source=source)
            elif top in _JS_AUTH_PROVIDER_IMPORTS:
                yield Evidence(
                    id=ids.next(), fact="auth_provider_dependency",
                    detail=f"{_JS_AUTH_PROVIDER_IMPORTS[top]} — managed authentication provider — `import ... from '{module}'`",
                    source=source,
                )
            elif top in _JS_FRONTEND_FRAMEWORK_IMPORTS:
                yield Evidence(
                    id=ids.next(), fact="frontend_framework",
                    detail=f"{_JS_FRONTEND_FRAMEWORK_IMPORTS[top]} (frontend UI framework) — `import ... from '{module}'`",
                    source=source,
                )
            elif _DENO_EDGE_FUNCTION_MARKER in module:
                yield Evidence(
                    id=ids.next(), fact="web_framework",
                    detail=f"Deno/Supabase Edge Function runtime (serve() from deno.land/std) — `import ... from '{module}'`",
                    source=source,
                )

        for m in _JS_ROUTE_RE.finditer(line):
            receiver, method, route_path = m.group(1), m.group(2), m.group(3)
            if receiver.lower() in _ROUTE_FALSE_POSITIVE_RECEIVERS:
                continue
            yield Evidence(id=ids.next(), fact="rest_route", detail=f"{method.upper()} {route_path}", source=f"{file.rel_path}:{lineno}")

        for m in _FETCH_OR_AXIOS_URL_RE.finditer(line):
            url = m.group(1)
            for host, label in _KNOWN_API_HOSTS.items():
                if host in url:
                    yield Evidence(
                        id=ids.next(), fact="third_party_api_call",
                        detail=f"{label} — real API call to `{url}`",
                        source=f"{file.rel_path}:{lineno}",
                    )
                    break

        for m in _SUPABASE_AUTH_RE.finditer(line):
            yield Evidence(
                id=ids.next(), fact="auth_usage",
                detail=f"Supabase Auth — `.auth.{m.group(1)}()` call, real authentication flow in use",
                source=f"{file.rel_path}:{lineno}",
            )

        if mentions_supabase:
            for m in _SUPABASE_TABLE_RE.finditer(line):
                table = m.group(1)
                yield Evidence(
                    id=ids.next(), fact="database_table_usage",
                    detail=f"queries table `{table}` — `.from('{table}')`",
                    source=f"{file.rel_path}:{lineno}",
                )

        for m in _MONGOOSE_MODEL_RE.finditer(line):
            model_name = m.group(1)
            yield Evidence(
                id=ids.next(), fact="database_schema",
                detail=f"collection `{model_name}` defined (Mongoose model)",
                source=f"{file.rel_path}:{lineno}",
            )


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


_SQL_CREATE_TABLE_RE = re.compile(r"""create\s+table\s+(?:if\s+not\s+exists\s+)?["'`\[]?([\w.]+)["'`\]]?""", re.IGNORECASE)
# A Supabase-managed table is very often never CREATE TABLE'd in a
# migration at all — created once through the dashboard UI instead, with
# only its RLS policies and later ALTERs ever committed to the repo.
# Found live: a real repo's one migration file had zero CREATE TABLE
# statements, only `CREATE POLICY "..." ON public.voters ...` — real,
# unambiguous evidence the table exists, just not evidence it was
# DEFINED here, hence the separate, lower-confidence detail wording below
# ("referenced" vs. CREATE TABLE's "defined").
# DOTALL: a real formatted migration commonly wraps "CREATE POLICY ...
# ON <table>" across two lines (policy name on one line, ON <table> on
# the next — found live, in the exact real migration this whole feature
# is testing against) — a per-line regex would never see across that
# break at all. `.*?` stays non-greedy so it still stops at the first
# real `on`, not some later one.
_SQL_TABLE_REFERENCE_RE = re.compile(r"""(?:create\s+policy\s+.*?\bon\s+|alter\s+table\s+(?:if\s+exists\s+)?)["'`\[]?([\w.]+)["'`\]]?""", re.IGNORECASE | re.DOTALL)


def _line_number_at(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _extract_sql(file: DiscoveredFile, ids: _IdGen) -> Iterator[Evidence]:
    """Real schema evidence a Supabase/other-migration-based project's
    actual database structure lives in — before this, a .sql file wasn't
    even in discovery's extension allowlist, so this was completely
    invisible regardless of what it said. Deliberately just regex over a
    handful of DDL shapes (this pipeline's established "pattern-based,
    not a real parser" discipline — see the module docstring), not an
    attempt to understand full DDL: a table NAME is real, citable
    evidence a database exists and roughly what it's for; anything past
    that (column types, foreign keys) would risk more guessing than this
    pass is meant to do. Engine-agnostic on purpose — this alone doesn't
    say Postgres vs. something else; the LLM reconstruction step combines
    it with whichever *_dependency evidence exists elsewhere in the repo
    (e.g. supabase_dependency) to conclude which one.

    Whole-text regex (not per-line, like every other extractor in this
    module) specifically because SQL statements routinely wrap across
    lines — CREATE TABLE's column list always does, and a formatted
    CREATE POLICY's `ON <table>` clause often lands on its own line."""
    text = _read_text(file.path)
    if text is None:
        return
    seen: set[tuple[str, str]] = set()

    for m in _SQL_CREATE_TABLE_RE.finditer(text):
        table = m.group(1)
        key = ("defined", table)
        if key in seen:
            continue
        seen.add(key)
        yield Evidence(id=ids.next(), fact="database_schema", detail=f"table `{table}` defined (CREATE TABLE)", source=f"{file.rel_path}:{_line_number_at(text, m.start())}")

    for m in _SQL_TABLE_REFERENCE_RE.finditer(text):
        table = m.group(1)
        key = ("referenced", table)
        if key in seen:
            continue
        seen.add(key)
        yield Evidence(
            id=ids.next(), fact="database_schema",
            detail=f"table `{table}` referenced (RLS policy / ALTER TABLE — not necessarily defined in this migration)",
            source=f"{file.rel_path}:{_line_number_at(text, m.start())}",
        )


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
        elif file.extension == ".sql":
            evidence.extend(_extract_sql(file, ids))
        elif file.extension in (".yml", ".yaml"):
            continue  # a non-compose YAML file (CI config, k8s manifest, ...) carries no MVP-scoped signal today
        elif file.path.name == "Dockerfile" or file.path.name.startswith("Dockerfile."):
            evidence.append(Evidence(id=ids.next(), fact="dockerfile_present", detail="Dockerfile present — this service is containerized", source=file.rel_path))
        # .env / .env.example are intentionally not read for values (secrets), only
        # their presence is weak evidence of externally-configured dependencies —
        # the per-file env var NAMES already come from real code via env_var_usage.

    return evidence, unsupported
