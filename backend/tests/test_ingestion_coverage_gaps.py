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
Deno.serve(async (req) => {
  const key = Deno.env.get('SENDGRID_API_KEY');
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
    assert "rest_route" in facts  # the one piece that already worked (the send-otp function itself)
