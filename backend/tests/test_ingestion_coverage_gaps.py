"""
Tests for the 3 ingestion-extraction coverage gaps found and fixed live
while testing GitHub-URL import against a real repo (a plain Vite+React
frontend talking to Supabase, no Next.js, no ORM driver): a
backend-as-a-service SDK import (Supabase/Firebase) produced zero
database evidence, a plain frontend framework import (React/Vue/Svelte/
Angular) produced zero service evidence at all, and .sql migration files
weren't even in discovery's extension allowlist. Same offline,
no-LLM-call style as test_ingestion.py (see its own docstring for why).
"""
from __future__ import annotations

from pathlib import Path

from app.services.ingestion_discovery import discover_files
from app.services.ingestion_extract import extract_evidence


def _write(root: Path, rel_path: str, content: str) -> None:
    path = root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_supabase_client_import_produces_database_evidence(tmp_path: Path):
    _write(tmp_path, "src/lib/supabase.ts", """\
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(url, key);
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert any(e.fact == "supabase_dependency" and "Postgres" in e.detail for e in evidence)


def test_firebase_import_produces_database_evidence(tmp_path: Path):
    _write(tmp_path, "src/lib/firebase.ts", """\
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert any(e.fact == "firebase_dependency" for e in evidence)


def test_plain_react_frontend_now_produces_frontend_evidence(tmp_path: Path):
    """The actual real-world bug: a Vite/CRA React app (no Next.js)
    previously produced NOTHING — not one piece of evidence anywhere in
    the whole pipeline said "this is a frontend"."""
    _write(tmp_path, "src/App.tsx", """\
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

export default function App() {
  const [count, setCount] = useState(0);
  return null;
}
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    facts = {e.fact for e in evidence}
    assert "frontend_framework" in facts
    react_evidence = [e for e in evidence if e.fact == "frontend_framework"]
    assert any("React" in e.detail for e in react_evidence)


def test_vue_and_svelte_also_produce_frontend_evidence(tmp_path: Path):
    _write(tmp_path, "src/main.js", "import { createApp } from 'vue';\n")
    _write(tmp_path, "src/App.svelte.js", "import { onMount } from 'svelte';\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    details = " ".join(e.detail for e in evidence if e.fact == "frontend_framework")
    assert "Vue" in details
    assert "Svelte" in details


def test_sql_migration_is_now_discovered_and_produces_schema_evidence(tmp_path: Path):
    """Before this fix, .sql wasn't even in discovery's extension
    allowlist — this file would never reach an extractor at all,
    regardless of what it contained."""
    _write(tmp_path, "supabase/migrations/0001_init.sql", """\
create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

CREATE TABLE votes (
  id uuid primary key,
  candidate_id uuid references candidates(id)
);
""")
    files = discover_files(tmp_path)
    rel_paths = {f.rel_path for f in files}
    assert "supabase/migrations/0001_init.sql" in rel_paths

    evidence, _ = extract_evidence(files)
    schema_evidence = [e for e in evidence if e.fact == "database_schema"]
    tables = {e.detail for e in schema_evidence}
    assert any("candidates" in t for t in tables)
    assert any("votes" in t for t in tables)


def test_sql_extraction_dedupes_repeated_table_names_in_one_file(tmp_path: Path):
    _write(tmp_path, "schema.sql", """\
create table users (id int);
-- a later ALTER or a repeated migration reference shouldn't double-count
create table users (id int);
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    schema_evidence = [e for e in evidence if e.fact == "database_schema"]
    assert len(schema_evidence) == 1


def test_fetch_call_to_a_known_api_host_produces_third_party_api_call_evidence(tmp_path: Path):
    """Reproduces the real bug found live: a raw fetch() call to a known
    SaaS API is STRONGER evidence than any import, but before this fix
    nothing looked at fetch/axios call arguments at all."""
    _write(tmp_path, "src/notify.ts", """\
const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
  method: 'POST',
});
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "third_party_api_call"]
    assert len(matches) == 1
    assert "SendGrid" in matches[0].detail
    assert "api.sendgrid.com" in matches[0].detail


def test_axios_call_to_a_known_api_host_is_also_recognized(tmp_path: Path):
    _write(tmp_path, "src/pay.ts", "await axios.post('https://api.stripe.com/v1/charges', {});\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "third_party_api_call"]
    assert len(matches) == 1
    assert "Stripe" in matches[0].detail


def test_fetch_to_an_unrecognized_host_produces_no_evidence(tmp_path: Path):
    """Curated, not exhaustive -- an unrecognized host must not produce a
    guessed vendor name, same discipline as engines.py/docker_images.py."""
    _write(tmp_path, "src/misc.ts", "await fetch('https://some-random-internal-service.example.com/api');\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert not any(e.fact == "third_party_api_call" for e in evidence)


def test_deno_env_get_is_no_longer_misreported_as_a_rest_route(tmp_path: Path):
    """The exact false positive found live: `Deno.env.get('KEY')` matches
    the same shape as `router.get(path, handler)` and was wrongly
    reported as a "GET KEY" REST route."""
    _write(tmp_path, "func.ts", "const key = Deno.env.get('SENDGRID_API_KEY');\n")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    assert not any(e.fact == "rest_route" for e in evidence)


def test_real_route_handlers_still_work_after_the_env_get_fix(tmp_path: Path):
    """The false-positive fix must not throw out real routes — only the
    specific `env.get(...)` receiver shape is excluded."""
    _write(tmp_path, "server.ts", """\
app.get('/users', handler);
router.post('/orders', createOrder);
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    routes = {e.detail for e in evidence if e.fact == "rest_route"}
    assert "GET /users" in routes
    assert "POST /orders" in routes


def test_deno_edge_function_import_produces_web_framework_evidence(tmp_path: Path):
    """The follow-up gap found live: recognizing SendGrid's fetch() call
    (the earlier fix) still left the SendGrid node unwired, because
    nothing marked the Deno Edge Function FILE ITSELF as a real service —
    it had no npm web-framework import to match. Deno's std HTTP server
    is imported by URL, not a package name, so it needs its own check."""
    _write(tmp_path, "supabase/functions/send-otp/index.ts", """\
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

serve(async (req) => new Response('ok'));
""")
    files = discover_files(tmp_path)
    evidence, _ = extract_evidence(files)
    matches = [e for e in evidence if e.fact == "web_framework"]
    assert len(matches) == 1
    assert "Deno" in matches[0].detail


def test_the_real_repo_shape_now_produces_a_frontend_and_a_database_not_just_the_otp_edge():
    """Reproduces, offline, the actual gap found live against
    github.com/Soban-2004/voting_website: a plain React frontend +
    Supabase client + SQL migrations, alongside the one Supabase Edge
    Function that WAS already being picked up. Before this fix, only the
    edge function's evidence existed; now the frontend and database are
    real, citable nodes too."""

    def build(tmp_path: Path) -> Path:
        _write(tmp_path, "src/App.tsx", "import { useState } from 'react';\n")
        _write(tmp_path, "src/lib/supabaseClient.ts", "import { createClient } from '@supabase/supabase-js';\n")
        _write(tmp_path, "supabase/migrations/0001_init.sql", "create table candidates (id uuid primary key);\n")
        _write(tmp_path, "supabase/functions/send-otp/index.ts", """\
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

serve(async (req) => {
  const key = Deno.env.get('SENDGRID_API_KEY');
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}` },
  });
  return new Response('ok');
});
""")
        return tmp_path

    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = build(Path(tmp))
        files = discover_files(root)
        evidence, _ = extract_evidence(files)
        facts = {e.fact for e in evidence}

    assert "frontend_framework" in facts  # was completely missing before
    assert "supabase_dependency" in facts  # was completely missing before
    assert "database_schema" in facts  # was completely missing before
    assert "third_party_api_call" in facts  # was completely missing before (real fetch(), not just an env var name)
    assert "web_framework" in facts  # the Deno serve() import -- without it the SendGrid dependency has nothing to be wired from
    assert "rest_route" not in facts  # Deno.env.get(...) must NOT be misreported as a route anymore
