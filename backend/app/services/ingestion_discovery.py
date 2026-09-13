"""
File discovery for existing-project ingestion (spec §6 Phase 5, pipeline
step 1): "respect .gitignore, skip binaries/vendored deps/lockfiles,
size-cap per file." This is deliberately dumb and deterministic — no LLM
involvement, no attempt to judge what's "interesting" — that judgment
happens later, over the Evidence Graph these files get reduced to
(ingestion_extract.py), not here.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pathspec

# Directories never worth walking into regardless of .gitignore content —
# these are either huge, binary-heavy, or (like .git) not source at all.
_ALWAYS_SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    "env", ".env", "dist", "build", ".next", ".turbo", "target", ".mypy_cache",
    ".pytest_cache", ".tox", "coverage", ".idea", ".vscode", "vendor",
    "egg-info", ".eggs",
}

# Lockfiles and generated manifests: real signal for "what's in this repo"
# is already better captured by the source files that declare imports —
# these are typically huge, low-information-density, and would drown out
# genuine evidence if walked like a normal source file.
_ALWAYS_SKIP_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
    "Pipfile.lock", "uv.lock", "Cargo.lock", "composer.lock",
}

# Extensions this pipeline can meaningfully read as text and extract
# evidence from (spec's MVP language/infra coverage) — anything else is
# either binary or outside MVP scope, and is surfaced via
# EvidenceGraph.unsupported_notes rather than silently walked and ignored.
_RELEVANT_EXTENSIONS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".yml", ".yaml",  # docker-compose and similar
    ".sql",  # migrations — real schema evidence (CREATE TABLE), see ingestion_extract.py's _extract_sql
    ".env", ".env.example",
    "Dockerfile",
}

MAX_FILE_SIZE_BYTES = 200_000  # a 200KB "source" file is almost certainly generated/vendored, not hand-written evidence
MAX_TOTAL_FILES = 2000  # a hard ceiling so a huge/misidentified repo fails predictably rather than hanging


@dataclass
class DiscoveredFile:
    path: Path  # absolute path on disk
    rel_path: str  # path relative to the repo root, using forward slashes — what gets cited as `source`
    extension: str


def _load_gitignore(root: Path) -> pathspec.PathSpec:
    gitignore_path = root / ".gitignore"
    lines: list[str] = []
    if gitignore_path.is_file():
        try:
            lines = gitignore_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            lines = []
    return pathspec.PathSpec.from_lines("gitignore", lines)


def discover_files(root: Path) -> list[DiscoveredFile]:
    """Walks `root`, returns every file worth extracting evidence from.
    Applies, in order: always-skip directories, .gitignore (real
    semantics via pathspec, not a hand-rolled approximation), always-skip
    files, extension allowlist, and the per-file size cap. Silently
    stops discovering more files past MAX_TOTAL_FILES rather than
    unbounded — ingestion.py surfaces that as an unsupported_note, not a
    crash."""
    spec = _load_gitignore(root)
    found: list[DiscoveredFile] = []

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if any(part in _ALWAYS_SKIP_DIRS for part in path.relative_to(root).parts[:-1]):
            continue
        if path.name in _ALWAYS_SKIP_FILES:
            continue

        rel = path.relative_to(root).as_posix()
        if spec.match_file(rel):
            continue

        is_dockerfile = path.name == "Dockerfile" or path.name.startswith("Dockerfile.")
        if not is_dockerfile and path.suffix not in _RELEVANT_EXTENSIONS:
            continue

        try:
            if path.stat().st_size > MAX_FILE_SIZE_BYTES:
                continue
        except OSError:
            continue

        found.append(DiscoveredFile(path=path, rel_path=rel, extension=path.suffix or path.name))
        if len(found) >= MAX_TOTAL_FILES:
            break

    return found
