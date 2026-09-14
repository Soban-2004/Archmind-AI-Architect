"""
Shared fixtures for the intent-routing tests (test_intent_router.py,
test_interview_routing.py). No real database or LLM provider is ever
touched here: app.db.repository's functions and
app.llm.factory.get_llm_provider/get_judge_provider are monkeypatched
per-test with the fakes below, so these tests run offline and don't spend
real API tokens.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.state import ArchitectureState


def build_state(**overrides) -> ArchitectureState:
    """A small, realistic architecture — frontend -> load balancer ->
    backend -> database — reused across the routing tests. Pass e.g.
    nodes=[...] to override a top-level field entirely."""
    data = {
        "nodes": [
            {"id": "svc_fe", "name": "Frontend", "node_kind": "service", "type": "frontend"},
            {"id": "svc_be", "name": "Backend", "node_kind": "service", "type": "service"},
            {"id": "inf_lb", "name": "Load Balancer", "node_kind": "infra_node", "type": "load_balancer"},
            {"id": "dat_db", "name": "PostgreSQL", "node_kind": "database", "type": "relational", "role": "primary", "engine": "postgres"},
        ],
        "edges": [
            {"id": "edge_1", "from_id": "svc_fe", "to_id": "inf_lb", "protocol": "http", "sync_async": "sync"},
            {"id": "edge_2", "from_id": "inf_lb", "to_id": "svc_be", "protocol": "http", "sync_async": "sync"},
            {"id": "edge_3", "from_id": "svc_be", "to_id": "dat_db", "protocol": "sql", "sync_async": "sync"},
        ],
        "constraints": [
            {"type": "expected_rps", "value": "40-80"},
            {"type": "expected_users", "value": "100-500"},
        ],
    }
    data.update(overrides)
    return ArchitectureState.model_validate(data)


class FakeProvider:
    """Stands in for GroqProvider/GeminiProvider — records every call so a
    test can assert what was (and wasn't) sent, and returns a canned
    response instead of hitting a real API."""

    def __init__(self, structured_response=None, interview_response=None):
        self.last_usage = {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        self.structured_calls: list[tuple] = []
        self.interview_calls: list[tuple] = []
        self._structured_response = structured_response
        self._interview_response = interview_response

    async def structured_json(self, system_prompt, user_message, schema_model):
        self.structured_calls.append((system_prompt, user_message, schema_model))
        if self._structured_response is None:
            raise AssertionError("FakeProvider.structured_json called with no canned response configured")
        return self._structured_response

    async def interview_turn(self, system_prompt, conversation, retry_note=None):
        self.interview_calls.append((system_prompt, conversation, retry_note))
        if self._interview_response is None:
            raise AssertionError("FakeProvider.interview_turn called with no canned response configured")
        return self._interview_response


class FakeRepo:
    """A minimal in-memory stand-in for app.db.repository, scoped to what
    handle_chat_turn actually calls. `versions_created` is the main thing
    the routing tests assert on: it must stay empty for every non-mutating
    turn (advisory, analysis, and the empty-commands safety net)."""

    def __init__(self, base_version: dict | None):
        self._base_version = base_version
        self.messages: list[dict] = []
        self.versions_created: list[dict] = []

    async def get_version(self, version_id, owner_token=None):
        if self._base_version and self._base_version["id"] == version_id:
            return self._base_version
        return None

    async def get_latest_version(self, project_id, owner_token=None):
        return self._base_version

    async def get_project(self, project_id, owner_token=None):
        # These tests aren't exercising ownership at all -- just needs to
        # be truthy so handle_chat_turn/direct_update_node/
        # direct_apply_commands's own "does this project exist" check
        # (added alongside real per-visitor isolation) doesn't
        # short-circuit into an error before reaching the logic actually
        # under test here.
        return {"id": project_id, "name": "Fake Project"}

    async def add_message(self, project_id, role, content, version_id=None):
        msg_id = uuid4()
        self.messages.append({"id": msg_id, "project_id": project_id, "role": role, "content": content, "version_id": version_id})
        return msg_id

    async def set_message_version(self, message_id, version_id):
        for m in self.messages:
            if m["id"] == message_id:
                m["version_id"] = version_id

    async def get_branch_history(self, project_id, version_id):
        return [{"role": m["role"], "content": m["content"]} for m in self.messages]

    async def create_version(self, project_id, state, kind, parent_version_id=None, label=None, layout=None):
        version = {
            "id": uuid4(),
            "project_id": project_id,
            "parent_version_id": parent_version_id,
            "label": label,
            "kind": kind,
            "state": state.model_dump(mode="json"),
            "layout": layout or {},
        }
        self.versions_created.append(version)
        return version

    async def create_adrs(self, project_id, version_id, adrs):
        pass


@pytest.fixture
def state() -> ArchitectureState:
    return build_state()


@pytest.fixture
def base_version(state: ArchitectureState) -> dict:
    return {
        "id": uuid4(),
        "project_id": uuid4(),
        "parent_version_id": None,
        "label": None,
        "kind": "initial",
        "state": state.model_dump(mode="json"),
        "layout": {},
    }


@pytest.fixture
def fake_repo(monkeypatch, base_version: dict) -> FakeRepo:
    """Patches every app.db.repository function services/interview.py
    calls onto a fresh FakeRepo seeded with `base_version`."""
    import app.services.interview as interview

    repo = FakeRepo(base_version)
    monkeypatch.setattr(interview.repo, "get_version", repo.get_version)
    monkeypatch.setattr(interview.repo, "get_latest_version", repo.get_latest_version)
    monkeypatch.setattr(interview.repo, "get_project", repo.get_project)
    monkeypatch.setattr(interview.repo, "add_message", repo.add_message)
    monkeypatch.setattr(interview.repo, "set_message_version", repo.set_message_version)
    monkeypatch.setattr(interview.repo, "get_branch_history", repo.get_branch_history)
    monkeypatch.setattr(interview.repo, "create_version", repo.create_version)
    monkeypatch.setattr(interview.repo, "create_adrs", repo.create_adrs)
    return repo


def patch_provider(monkeypatch, provider: FakeProvider, judge=None) -> None:
    """Points services/interview.py's get_llm_provider/get_judge_provider
    at fakes for the duration of one test. `judge=None` (the default)
    skips the judge pass entirely, matching _run_judge's own behavior when
    no judge is configured."""
    import app.services.interview as interview

    monkeypatch.setattr(interview, "get_llm_provider", lambda: provider)
    monkeypatch.setattr(interview, "get_judge_provider", lambda: judge)
