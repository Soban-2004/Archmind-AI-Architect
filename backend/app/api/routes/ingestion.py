"""
Existing-project ingestion endpoints (spec §6 Phase 5). Two entry points
into the exact same pipeline — a direct ZIP upload, or a public GitHub
repo URL this fetches the zip for server-side — both extract to a
temporary directory and run through the full deterministic-discovery ->
LLM-reconstruction pipeline (services/ingestion.py) — same validated
mutation-command path as every other architecture-producing flow, never
a special-cased shortcut.
"""
from __future__ import annotations

import re
import tempfile
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel

from app.rate_limit import INGEST_LIMIT, limiter
from app.services.ingestion import ingest_repository, persist_ingestion

router = APIRouter(prefix="/ingest", tags=["ingestion"])

MAX_UPLOAD_BYTES = 25_000_000  # 25MB — generous for a small sample project's source, not its node_modules/venv (discovery skips those anyway)


async def _process_zip_bytes(raw: bytes, name: str) -> dict:
    """Shared by both routes below: extract -> ingest_repository ->
    persist_ingestion -> the wire response shape. One place, so the
    upload and GitHub-URL paths can never quietly drift apart on what a
    result looks like."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"upload exceeds the {MAX_UPLOAD_BYTES // 1_000_000}MB limit")

    with tempfile.TemporaryDirectory(prefix="ai_architect_ingest_") as tmp_str:
        tmp = Path(tmp_str)
        zip_path = tmp / "upload.zip"
        zip_path.write_bytes(raw)

        extract_dir = tmp / "extracted"
        extract_dir.mkdir()
        try:
            with zipfile.ZipFile(zip_path) as zf:
                # Reject a zip-slip attempt (a member path that would
                # escape extract_dir) outright rather than silently
                # sanitizing it — an upload trying that is not a project
                # worth reconstructing from.
                for member in zf.namelist():
                    member_path = (extract_dir / member).resolve()
                    if not str(member_path).startswith(str(extract_dir.resolve())):
                        raise HTTPException(400, "zip contains an unsafe path")
                zf.extractall(extract_dir)
        except zipfile.BadZipFile:
            raise HTTPException(400, "not a valid zip file")

        # A single top-level directory (the common "repo-name/" shape both
        # a GitHub "Download ZIP" and GitHub's own archive endpoint
        # produce) shouldn't change what gets discovered — walk into it
        # so paths cited as evidence read as real repo-relative paths,
        # not "repo-name-branch/real/path".
        entries = list(extract_dir.iterdir())
        root = entries[0] if len(entries) == 1 and entries[0].is_dir() else extract_dir

        result = await ingest_repository(name, root)

        if not result.ok:
            return {
                "ok": False,
                "error": result.error,
                "unsupported_notes": result.evidence.unsupported_notes if result.evidence else [],
            }

        persisted = await persist_ingestion(name, result)
        return {
            "ok": True,
            "project": persisted["project"],
            "version": persisted["version"],
            "summary": result.summary,
            "citations": result.citations,
            "evidence": [e.model_dump(mode="json") for e in result.evidence.evidence] if result.evidence else [],
            "unsupported_notes": result.evidence.unsupported_notes if result.evidence else [],
            "dropped_uncited_refs": result.dropped_uncited_refs,
        }


@router.post("")
@limiter.limit(INGEST_LIMIT)
async def ingest_project(request: Request, response: Response, file: UploadFile = File(...), name: str = Form("Ingested Project")):
    # `response` unused directly but required — see chat.py's `chat` for why.
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "upload must be a .zip file")

    raw = await file.read()
    return await _process_zip_bytes(raw, name)


# --- GitHub URL import -------------------------------------------------

# Matches a plain github.com repo URL, optionally with a /tree/<ref>
# suffix (a specific branch/tag/commit) and nothing after it — GitHub's
# own web UI URLs can be ambiguous past that point (a branch name itself
# containing "/", or a path INTO the repo) in a way that genuinely needs
# GitHub's own API to disambiguate; this deliberately doesn't try, and
# just requires a plain repo (optionally pinned to one ref) instead. The
# bare "owner/repo" shorthand is accepted too, for convenience.
_GITHUB_URL_RE = re.compile(r"^(?:https?://)?(?:www\.)?github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?(?:/tree/(?P<ref>[^/]+))?/?$")
_SHORTHAND_RE = re.compile(r"^(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+)$")

GITHUB_API_TIMEOUT_SECONDS = 8.0
GITHUB_ARCHIVE_TIMEOUT_SECONDS = 20.0  # a real repo download, not a quick API call — generous but not unbounded


def parse_github_url(raw: str) -> tuple[str, str, str | None]:
    """Returns (owner, repo, ref) — ref is None when the URL didn't pin
    one, meaning "use the repo's actual default branch" (resolved via a
    real API call, never assumed to be "main"). Raises ValueError with a
    message safe to show the user directly."""
    text = raw.strip()
    m = _GITHUB_URL_RE.match(text) or _SHORTHAND_RE.match(text)
    if not m:
        raise ValueError("that doesn't look like a GitHub repo URL (expected e.g. github.com/owner/repo)")
    groups = m.groupdict()
    return groups["owner"], groups["repo"], groups.get("ref")


class GithubImportRequest(BaseModel):
    url: str
    name: str = "Imported Project"


@router.post("/github")
@limiter.limit(INGEST_LIMIT)
async def ingest_from_github(request: Request, response: Response, body: GithubImportRequest):
    """The same pipeline as POST /ingest, just fed by a zip this fetches
    server-side from GitHub's own public archive endpoint instead of
    requiring a manual download+upload round trip — no auth, so only
    public repos (a private one 404s, same as an anonymous browser
    request would, and is reported as such rather than a confusing
    generic failure)."""
    # `response` unused directly but required — see chat.py's `chat` for why.
    try:
        owner, repo, ref = parse_github_url(body.url)
    except ValueError as e:
        raise HTTPException(400, str(e))

    async with httpx.AsyncClient(timeout=GITHUB_API_TIMEOUT_SECONDS, follow_redirects=True) as client:
        if ref is None:
            try:
                api_res = await client.get(f"https://api.github.com/repos/{owner}/{repo}")
            except httpx.HTTPError as e:
                raise HTTPException(400, f"couldn't reach GitHub to look up the repo: {e}")
            if api_res.status_code == 404:
                raise HTTPException(400, f"'{owner}/{repo}' wasn't found on GitHub — check the URL, and note private repos aren't supported (no auth)")
            if api_res.status_code != 200:
                raise HTTPException(400, f"GitHub returned {api_res.status_code} looking up '{owner}/{repo}'")
            ref = api_res.json().get("default_branch", "main")

        archive_url = f"https://github.com/{owner}/{repo}/archive/{ref}.zip"
        try:
            async with client.stream("GET", archive_url, timeout=GITHUB_ARCHIVE_TIMEOUT_SECONDS) as archive_res:
                if archive_res.status_code == 404:
                    raise HTTPException(400, f"'{owner}/{repo}' at ref '{ref}' wasn't found — check the branch/tag exists")
                if archive_res.status_code != 200:
                    raise HTTPException(400, f"GitHub returned {archive_res.status_code} downloading '{owner}/{repo}'")

                # Streamed and capped by hand rather than trusted from
                # Content-Length: GitHub's archive response doesn't
                # always send one (chunked transfer), so the only honest
                # way to enforce MAX_UPLOAD_BYTES is to actually count
                # bytes as they arrive and stop early if it's exceeded.
                chunks: list[bytes] = []
                total = 0
                async for chunk in archive_res.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_UPLOAD_BYTES:
                        raise HTTPException(400, f"'{owner}/{repo}' exceeds the {MAX_UPLOAD_BYTES // 1_000_000}MB import limit")
                    chunks.append(chunk)
                raw = b"".join(chunks)
        except httpx.HTTPError as e:
            raise HTTPException(400, f"couldn't download '{owner}/{repo}' from GitHub: {e}")

    return await _process_zip_bytes(raw, body.name.strip() or f"{owner}/{repo}")
