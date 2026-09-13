from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Awaitable, Callable
from uuid import UUID

from app.db import repository as repo
from app.llm.factory import get_judge_provider, get_llm_provider
from app.llm.prompts import build_advisory_prompt, build_analysis_prompt, build_judge_prompt, build_system_prompt, state_for_edit_prompt
from app.llm.tokens import estimate_messages_tokens, estimate_tokens
from app.models.advisory import AdvisoryAnswer, AnalysisAnswer
from app.models.commands import AnnotateDecisionCommand, MutationCommand, UpdateNodeCommand
from app.models.diff import VersionDiff
from app.models.judge import JudgeVerdict
from app.models.state import ADR, ArchitectureState, TriggeredBy, empty_state, gen_id
from app.services.adr import build_templated_decision
from app.services.deterministic import try_deterministic_command
from app.services.diff import diff_states
from app.services.intent_router import classify_intent, extract_multiplier
from app.services.mutation_engine import apply_commands
from app.services.simulator import run_simulation

logger = logging.getLogger(__name__)

MAX_ENGINE_RETRIES = 2  # additional retries when mutation validation itself fails, or the judge rejects

# Groq's free/on-demand tier caps a single request at 8,000 tokens/minute
# — and that cap counts PROMPT + COMPLETION together. Calibrated against
# two real requests against a large, heavily-edited test project (18
# nodes/33 edges/8 ADRs): our ~4-chars-per-token *estimate* (llm/tokens.py
# — not an exact tokenizer count) came in at 6,260 for the fixed prompt
# cost alone (system prompt + schema + serialized current state, none of
# which trimming can touch), against a REAL prompt token count of 6,585 —
# a ~5% underestimate — and the completion for a real multi-command edit
# ran 1,207-1,254 tokens. Two real calls against that same project landed
# at 7,839/8,000 and 7,892/8,000: correct, but by a margin of ~1-2% that
# was luck, not a guarantee for the next slightly-bigger response.
GROQ_TPM_LIMIT = 8000
ESTIMATE_INFLATION = 1.15  # safety multiplier over our raw estimate before comparing to the provider's hard limit
# Re-calibrated after ADR-exclusion + schema/free-text compaction shrank
# the fixed prompt cost enough that this reserve became the actual binding
# constraint: on the real, current Stock Hinge project (13 nodes/14
# edges), the gate had only 19 estimated tokens of headroom left on a
# clean request with zero conversation history — a single additional node
# would have tripped it again, independent of anything about the request
# itself. The original 2,000 was set well above the one real multi-command
# completion measured at the time (~1,250); every completion this session
# has since measured live from Groq for a normal edit tops out well under
# 1,000. Landed on 1,500 rather than matching that narrower same-day
# sample: a generate_tier turn builds a whole architecture from scratch in
# one completion (many add_node/add_edge/set_constraint commands at once)
# and could plausibly run longer than any single-edit completion measured
# so far, so this keeps real margin above the largest completion actually
# documented (1,254) rather than chasing the smallest safe number that
# happens to fit today's narrower sample of ordinary edits.
EXPECTED_MAX_COMPLETION_TOKENS = 1500
TOTAL_TOKEN_BUDGET = 3500  # soft trim target for prompt+history — deliberately tighter than the hard gate below, so trimming kicks in first
MIN_HISTORY_TOKEN_BUDGET = 200  # always try to keep at least a little recent context


# Real, optional stage-progress reporting — genuinely real, not the
# rotating-cosmetic-text pattern useThinkingStatus.ts (frontend) uses
# elsewhere and documents honestly as fake: this fires exactly when each
# real step below actually starts, from the one place that has any idea
# what's really happening (this function itself), not a client-side timer
# guessing. Defaults to None everywhere so every existing caller (the
# plain JSON /chat route, direct_update_node, every test in this repo)
# behaves exactly as before — only the new streaming route (api/routes/
# chat.py's /chat/stream) actually passes one.
OnStage = Callable[[str], Awaitable[None]]


async def _emit(on_stage: OnStage | None, stage: str) -> None:
    if on_stage is not None:
        await on_stage(stage)


@dataclass
class ChatTurnResult:
    kind: str  # "question" | "architecture" | "error"
    question: str | None = None
    quick_replies: list[str] | None = None
    summary: str | None = None
    version: dict | None = None
    diff: VersionDiff | None = None
    error: str | None = None
    usage: dict[str, int] | None = None  # real token usage from the LLM call that produced this turn, if any


def _trim_history(history: list[dict], budget_tokens: int) -> tuple[list[dict], int]:
    """Keep as many of the most recent messages as fit in `budget_tokens`,
    dropping older ones from the front rather than truncating individual
    messages. This is safe to do aggressively (not just as a last resort)
    because the durable facts from older turns — constraints, prior
    decisions — already live in the architecture state and its ADRs, which
    get appended to the system prompt separately on every turn regardless
    of what conversation history is included. Returns (kept, dropped_count).
    """
    kept: list[dict] = []
    used = 0
    for m in reversed(history):
        t = estimate_tokens(m.get("content", "")) + 4
        if kept and used + t > budget_tokens:
            break
        kept.append(m)
        used += t
    kept.reverse()
    return kept, len(history) - len(kept)


def _friendly_provider_error(e: Exception) -> str:
    """A raw LLM-provider exception (rate limit, network hiccup, auth,
    ...) used to propagate straight out of handle_chat_turn uncaught —
    which risks the browser seeing a bare connection failure ("Failed to
    fetch") instead of any readable message, if it escapes far enough to
    dodge FastAPI's own CORS-wrapped error response. Give the user
    something they can actually act on instead.

    Checks the structured fields the groq client actually exposes
    (status_code, and error.code in the parsed body) first — those are
    exact, unlike string-sniffing the message — and only falls back to
    matching on the message text for providers/errors that don't expose
    them (e.g. a raw network failure has neither)."""
    status_code = getattr(e, "status_code", None)
    body = getattr(e, "body", None)
    error_code = None
    if isinstance(body, dict):
        error_code = (body.get("error") or {}).get("code")

    msg = str(e)
    lowered = msg.lower()
    is_rate_limit = (
        status_code in (429, 413)
        or error_code == "rate_limit_exceeded"
        or "rate_limit" in lowered
        or "tokens per minute" in lowered
    )
    if is_rate_limit:
        return (
            "The AI provider's rate limit was hit for this request — this project's "
            "conversation has grown long, and (even after trimming) this turn's "
            "history and current architecture state were too large for one request. "
            "Wait a few seconds and try again, or start a new project to reset the context."
        )
    return f"The AI provider request failed: {msg}"


async def _run_judge(user_message: str, new_state: ArchitectureState, commands: list, on_stage: OnStage | None = None) -> JudgeVerdict | None:
    """A second, independent model (Gemini — see llm/gemini_provider.py)
    reviewing the architect's (Groq's) proposed architecture for
    structural correctness against a fixed checklist (llm/prompts.py's
    JUDGE_SYSTEM_PROMPT) before it's accepted. `commands` (this turn's
    raw proposed commands, not just the resulting state) is what makes
    check 7 possible — the judge previously only ever saw the FINAL state,
    with no way to tell a node that existed before this turn from one just
    added, so it structurally could not ask "does what changed actually
    match the request" — found live: a proposal that added an entirely
    unrelated node passed every one of the original 6 checks, since none
    of them are about relevance to the request at all, just structural
    correctness of whatever's in the final diagram. Returns None — judge
    skipped, proposal used as-is — when no judge is configured
    (GEMINI_API_KEY unset) or the judge call itself fails; a second
    opinion is a quality improvement, not something the whole turn should
    fail over if it's unavailable, mirroring the fallback-on-LLM-failure
    pattern already used for compare.py/analyzer.py's non-core LLM calls."""
    judge = get_judge_provider()
    if judge is None:
        return None
    try:
        await _emit(on_stage, "Running a structural review…")
        prompt = build_judge_prompt(user_message, new_state.constraints, new_state, commands)
        verdict = await judge.structured_json(prompt, "Review this architecture.", JudgeVerdict)
        logger.info("judge verdict: approved=%s issues=%s", verdict.approved, [(i.severity, i.description) for i in verdict.issues])
        return verdict
    except Exception:
        logger.exception("judge pass failed; proceeding without a second opinion")
        return None


async def _handle_advisory(project_id: UUID, user_message: str, state: ArchitectureState, base_version_id: UUID, on_stage: OnStage | None = None) -> ChatTurnResult:
    """Question/recommendation lane (services/intent_router.py's
    "advisory" intent) — deliberately the cheapest possible LLM call: a
    compact topology summary + constraints, no full architecture state, no
    commands schema, no judge pass, and critically no create_version — a
    non-edit turn must never look like an edit to the rest of the system.
    Returns kind="answer" so the caller/frontend/API layer can render it
    without touching version/diff state at all."""
    provider = get_llm_provider()
    prompt = build_advisory_prompt(state, user_message)
    await _emit(on_stage, "Answering from the current architecture…")
    try:
        raw = await provider.structured_json(prompt, user_message, AdvisoryAnswer)
    except Exception as e:
        return ChatTurnResult(kind="error", error=_friendly_provider_error(e))

    await repo.add_message(project_id, "assistant", raw.answer, version_id=base_version_id)
    return ChatTurnResult(kind="answer", summary=raw.answer, usage=getattr(provider, "last_usage", None))


async def _handle_analysis(project_id: UUID, user_message: str, state: ArchitectureState, base_version_id: UUID, on_stage: OnStage | None = None) -> ChatTurnResult:
    """What-if lane (services/intent_router.py's "analysis" intent) — runs
    the REAL deterministic simulator first (the exact engine behind the
    Simulate tab, see services/simulator.py) and has the LLM only narrate
    its actual output, never guess at load numbers itself. Same
    non-mutating contract as _handle_advisory: no commands, no judge, no
    create_version."""
    await _emit(on_stage, "Running the simulation…")
    multiplier = extract_multiplier(user_message)
    sim_result = run_simulation(state, multiplier=multiplier, kill_node_ids=[])

    provider = get_llm_provider()
    prompt = build_analysis_prompt(sim_result, user_message)
    await _emit(on_stage, "Explaining the result…")
    try:
        raw = await provider.structured_json(prompt, user_message, AnalysisAnswer)
    except Exception as e:
        return ChatTurnResult(kind="error", error=_friendly_provider_error(e))

    await repo.add_message(project_id, "assistant", raw.answer, version_id=base_version_id)
    return ChatTurnResult(kind="answer", summary=raw.answer, usage=getattr(provider, "last_usage", None))


def _state_from_row(version_row: dict | None) -> ArchitectureState:
    if version_row is None:
        return empty_state()
    return ArchitectureState.model_validate(version_row["state"])


def _ensure_adr(new_state: ArchitectureState, diff: VersionDiff, model_provided_decision: bool) -> None:
    """Guarantee every meaningful edit/tier has a rationale on record (spec
    §6 Phase 2), regardless of whether the model called
    annotate_decision this turn. Deterministic, derived from the diff."""
    if model_provided_decision:
        return
    templated = build_templated_decision(diff)
    if templated is None:
        return  # nothing actually changed
    decision, rationale = templated
    new_state.adrs.append(
        ADR(id=gen_id("adr"), decision=decision, rationale=rationale, triggered_by=TriggeredBy.user_request)
    )


async def _finalize(
    project_id: UUID,
    diff_base_state: ArchitectureState,
    new_state: ArchitectureState,
    parent_version_id: UUID | None,
    kind: str,
    summary: str,
    model_provided_decision: bool,
    label: str | None = None,
    usage: dict[str, int] | None = None,
    user_message_id: UUID | None = None,
    on_stage: OnStage | None = None,
) -> ChatTurnResult:
    await _emit(on_stage, "Finalizing…")
    diff = diff_states(diff_base_state, new_state) if parent_version_id else None
    if diff is not None:
        _ensure_adr(new_state, diff, model_provided_decision)

    version = await repo.create_version(project_id, new_state, kind=kind, parent_version_id=parent_version_id, label=label)
    if new_state.adrs:
        # For an edit, new_state.adrs carries the base's history forward
        # plus (maybe) one new entry, so this filters to just the new one.
        # For a tier/initial, new_state.adrs is built fresh from empty
        # state and never shares ids with diff_base_state.adrs, so nothing
        # is excluded — every entry is new and gets persisted.
        already_persisted_ids = {a.id for a in diff_base_state.adrs}
        await repo.create_adrs(
            project_id,
            version["id"],
            [
                {"decision": a.decision, "rationale": a.rationale, "triggered_by": a.triggered_by.value}
                for a in new_state.adrs
                if a.id not in already_persisted_ids
            ],
        )

    # Both halves of this turn now belong to the version it actually
    # produced, not the one it started from — see get_branch_history(): a
    # sibling tier branching off the same base must never see this
    # conversation, and this is what keeps it out.
    if user_message_id is not None:
        await repo.set_message_version(user_message_id, version["id"])
    await repo.add_message(project_id, "assistant", summary, version_id=version["id"])
    return ChatTurnResult(kind="architecture", summary=summary, version=version, diff=diff, usage=usage)


async def handle_chat_turn(project_id: UUID, user_message: str, base_version_id: UUID | None = None, on_stage: OnStage | None = None) -> ChatTurnResult:
    """`base_version_id` is whatever version the frontend currently has
    active — an edit or a tier request both branch off it. This is what
    lets sibling tiers (spec §6 Phase 3) share one base instead of chaining
    off each other, and incidentally makes editing from an older version in
    history a proper branch instead of being blocked. `on_stage`, if given,
    is called with a short real-progress string at each stage this turn
    actually reaches — see OnStage's docstring above; every existing
    caller omits it and behaves exactly as before."""
    if base_version_id is not None:
        base_version = await repo.get_version(base_version_id)
        if base_version is None or base_version["project_id"] != project_id:
            return ChatTurnResult(kind="error", error="base_version_id not found")
    else:
        base_version = await repo.get_latest_version(project_id)

    current_state = _state_from_row(base_version)
    parent_id = base_version["id"] if base_version else None

    # Tagged with the version this turn is building on for now — retagged
    # to whatever version it actually produces once that's known (inside
    # _finalize), so a sibling branch built off the same base never sees
    # this conversation (get_branch_history). A question that doesn't
    # produce a new version at all correctly keeps this tag as-is.
    user_message_id = await repo.add_message(project_id, "user", user_message, version_id=parent_id)

    # --- Tier 1 (spec §7): deterministic, no LLM call at all ---------------
    await _emit(on_stage, "Checking for a direct match…")
    if base_version is not None:
        det = try_deterministic_command(user_message, current_state)
        if det is not None:
            command, summary = det
            result = apply_commands(current_state, [command])
            if result.ok:
                assert result.state is not None
                return await _finalize(
                    project_id, current_state, result.state, parent_id, "edit", summary,
                    model_provided_decision=False, user_message_id=user_message_id, on_stage=on_stage,
                )
            # fall through to the LLM if the deterministic guess somehow fails validation

    # --- Tier 1.5: deterministic intent routing (services/intent_router.py)
    # ------------------------------------------------------------------
    # Not every message is an edit request. This is still a no-LLM-call
    # check like Tier 1 above, and only ever diverts on a CONFIDENT,
    # unambiguous non-edit phrasing — anything ambiguous or edit-shaped
    # returns None and falls straight through to the full Tier 2 pipeline
    # below, unchanged. Only meaningful once there's an actual architecture
    # to ask about; a brand new empty project always goes through the
    # normal requirements interview instead.
    if base_version is not None:
        intent = classify_intent(user_message)
        if intent == "advisory":
            return await _handle_advisory(project_id, user_message, current_state, parent_id, on_stage=on_stage)
        if intent == "analysis":
            return await _handle_analysis(project_id, user_message, current_state, parent_id, on_stage=on_stage)

    # --- Tier 2 (spec §7): LLM-assisted, structured output only ------------
    # Scoped to this branch's own ancestry, not the whole project's flat
    # log — a live-observed real bug (see README): asking to edit one tier
    # used to confuse the model with an unrelated sibling tier's request in
    # the same flat history.
    history = [{"role": m["role"], "content": m["content"]} for m in await repo.get_branch_history(project_id, parent_id)]

    provider = get_llm_provider()
    system_prompt = build_system_prompt()
    # state_for_edit_prompt (llm/prompts.py) drops `adrs` entirely (history
    # never needed to correctly wire a new node/edge) and caps the two
    # free-text prose fields (responsibilities/notes) — everything else
    # (ids, types, roles) stays exact, since a mutation command references
    # those directly and truncating an id would silently break it. On the
    # real, live Stock Hinge project (13 nodes, 13 ADRs accumulated over 17
    # versions) the ADR exclusion alone was ~1,200 of the tokens the
    # pre-flight gate below counts against every single edit request —
    # completely independent of project topology size or how targeted the
    # edit itself is, so it was the single biggest lever available without
    # changing what the model actually needs to see; the text cap is
    # front-loaded ahead of when it'll matter, for whenever a project's
    # free-text fields grow verbose over many future edits.
    system_prompt += f"\n\nCurrent architecture state (may be empty for a brand new project):\n{state_for_edit_prompt(current_state)}"

    # Stop sending the full history on every request (the actual incident
    # this guards against: a long project's whole message log pushed one
    # request over Groq's per-minute token cap). The durable facts from
    # trimmed-away turns already live in the architecture state/ADRs just
    # appended above, so this is safe to trim rather than needing a
    # separately-maintained summary. Budget adapts to how much room the
    # (fixed-cost) system prompt + current state already used, since on a
    # large architecture that alone can be most of the budget.
    base_tokens = estimate_tokens(system_prompt)
    history_budget = max(MIN_HISTORY_TOKEN_BUDGET, TOTAL_TOKEN_BUDGET - base_tokens)
    conversation, dropped = _trim_history(history, history_budget)
    if dropped > 0:
        system_prompt += (
            f"\n\n({dropped} earlier message(s) in this conversation were omitted here to stay within "
            "the LLM's context budget. The architecture state and its constraints/ADRs above already "
            "capture the durable facts from them.)"
        )

    # A hard pre-flight check, not just a trim: if even the fixed cost
    # (prompt/schema text + current architecture state, which can't be
    # trimmed without corrupting what the model needs to edit correctly)
    # already leaves no real room for a completion, no amount of
    # history-trimming will save this request — fail clearly now instead
    # of spending an API call gambling on the exact real tokenizer count
    # sneaking under the limit (as it barely did, twice, before this
    # check existed — see the calibration notes above).
    total_estimate = base_tokens + estimate_messages_tokens(conversation)
    projected_total = int(total_estimate * ESTIMATE_INFLATION) + EXPECTED_MAX_COMPLETION_TOKENS
    if projected_total > GROQ_TPM_LIMIT:
        return ChatTurnResult(
            kind="error",
            error=(
                "This architecture has grown too large for the AI's context budget in one request "
                f"(roughly {total_estimate} tokens for the prompt alone, before leaving room for the "
                "response). Try a smaller, more targeted edit, or start a new tier instead of "
                "extending this one further."
            ),
        )

    # Accumulated across every attempt in this loop, not just the last one
    # — a retry (validation failure or judge rejection) still spends real
    # tokens on the attempt that got discarded, and the session token
    # counter should reflect what was actually spent, not just what the
    # final accepted attempt cost.
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    def _add_usage(u: dict[str, int] | None) -> None:
        if not u:
            return
        for k in total_usage:
            total_usage[k] += u.get(k, 0)

    retry_note: str | None = None
    for attempt in range(MAX_ENGINE_RETRIES + 1):
        await _emit(on_stage, "Consulting the architect…" if attempt == 0 else f"The first attempt needs a fix — retrying (attempt {attempt + 1})…")
        try:
            turn = await provider.interview_turn(system_prompt, conversation, retry_note=retry_note)
        except Exception as e:
            # A provider-level failure (rate limit, network, auth) isn't
            # something a same-request retry can fix, and letting it
            # propagate unhandled is exactly what produced a bare "Failed
            # to fetch" in the browser instead of a readable error —
            # mirrors the fallback-on-LLM-failure pattern already used in
            # compare.py/analyzer.py for the non-core-path LLM calls.
            return ChatTurnResult(kind="error", error=_friendly_provider_error(e))

        _add_usage(getattr(provider, "last_usage", None))

        if turn.action == "ask_question":
            await repo.add_message(project_id, "assistant", turn.question or "", version_id=parent_id)
            return ChatTurnResult(kind="question", question=turn.question, quick_replies=turn.quick_replies, usage=total_usage)

        commands = turn.commands or []
        is_tier = turn.action == "generate_tier"
        base_for_commands = empty_state() if is_tier else current_state
        await _emit(on_stage, "Validating the proposed changes…")
        result = apply_commands(base_for_commands, commands)

        if not result.ok:
            retry_note = "; ".join(f"[cmd {e.command_index} {e.op}] {e.error}" for e in result.errors)
            # Registry connectivity errors ("invalid connection: ...") are a
            # different KIND of problem than a malformed-JSON retry, and the
            # shared RETRY_SUFFIX ("Fix it and return ONLY corrected JSON")
            # is worded for the latter — live testing showed a retry
            # correctly avoid the exact rejected edge, but reproduce the
            # same category of mistake against a different node
            # (frontend -> load_balancer rejected, retried as
            # frontend -> api_gateway). Spell out explicitly that this is a
            # structural rule, not a formatting one, and that swapping the
            # target doesn't fix it.
            if any("invalid connection:" in e.error for e in result.errors):
                retry_note = (
                    "These are connection-direction rules, not JSON formatting problems — "
                    "swapping which node the same kind of backwards edge points to does NOT fix "
                    "this. Remove the offending edge(s) entirely, or reverse their direction: "
                    + retry_note
                )
            logger.info("validation failed on attempt %d: %s", attempt, retry_note)
            if attempt < MAX_ENGINE_RETRIES:
                continue
            return ChatTurnResult(kind="error", error=f"Could not apply proposed architecture: {retry_note}")

        new_state = result.state
        assert new_state is not None

        # A model that picks propose_architecture but emits zero commands
        # produced no actual change — this used to still fall through to
        # _finalize() unconditionally, silently creating a no-op version
        # and paying for a judge pass reviewing an unchanged architecture.
        # services/intent_router.py now catches the common phrasings of
        # "this is actually just a question" before any LLM call at all,
        # so this should be rare — this guard is the safety net for
        # whatever a message the router correctly left on the edit path
        # (it looked edit-shaped) but that the model still decided didn't
        # warrant an actual change. Never versioned, never judged.
        if not commands and not is_tier:
            answer = turn.summary or "No change needed."
            await repo.add_message(project_id, "assistant", answer, version_id=parent_id)
            return ChatTurnResult(kind="answer", summary=answer, usage=total_usage)

        verdict = await _run_judge(user_message, new_state, commands, on_stage=on_stage)
        if verdict is not None:
            _add_usage(getattr(get_judge_provider(), "last_usage", None))
            blocking = [i for i in verdict.issues if i.severity == "blocking"]
            if blocking and attempt < MAX_ENGINE_RETRIES:
                retry_note = "A structural review flagged: " + "; ".join(i.description for i in blocking)
                continue

        summary = turn.summary or ("New tier generated." if is_tier else "Architecture updated.")
        model_provided_decision = any(isinstance(c, AnnotateDecisionCommand) for c in commands)

        return await _finalize(
            project_id,
            current_state,  # diff a tier against the base it was generated from, same as an edit
            new_state,
            parent_id,
            kind="tier" if is_tier else ("initial" if base_version is None else "edit"),
            summary=summary,
            model_provided_decision=model_provided_decision,
            label=turn.tier_label if is_tier else None,
            usage=total_usage,
            user_message_id=user_message_id,
            on_stage=on_stage,
        )

    return ChatTurnResult(kind="error", error="Unexpected: exhausted retries without returning.")


async def direct_update_node(project_id: UUID, base_version_id: UUID, node_id: str, attributes: dict) -> ChatTurnResult:
    """A direct node edit from the canvas UI (click a node, tweak a field,
    save) — Tier 1 (spec §7): deterministic, no LLM call at all, same
    philosophy as try_deterministic_command, just triggered by a UI action
    instead of a parsed chat message. Goes through the exact same
    apply_commands validation (including the connectivity registry) and
    _finalize path as every other edit, so it produces a real versioned,
    diffed, ADR'd change — not a side-channel that bypasses the rest of
    the system's guarantees."""
    base_version = await repo.get_version(base_version_id)
    if base_version is None or base_version["project_id"] != project_id:
        return ChatTurnResult(kind="error", error="base_version_id not found")

    current_state = _state_from_row(base_version)
    result = apply_commands(current_state, [UpdateNodeCommand(id=node_id, attributes=attributes)])
    if not result.ok:
        return ChatTurnResult(kind="error", error="; ".join(e.error for e in result.errors))

    assert result.state is not None
    node = result.state.get_node(node_id)
    summary = f"Updated {node.name if node else node_id}."
    return await _finalize(project_id, current_state, result.state, base_version["id"], "edit", summary, model_provided_decision=False)


async def direct_apply_commands(project_id: UUID, base_version_id: UUID | None, commands: list[MutationCommand]) -> ChatTurnResult:
    """A manual edit from the canvas UI — add a node via the palette,
    drag-connect two nodes, delete a node or edge — one or several
    commands in a single batch (e.g. add_node + add_edge to wire the new
    node in immediately, using `ref` exactly like the LLM's own batches
    do). Same Tier 1 philosophy as direct_update_node just above: no LLM
    call, the exact same apply_commands validation (including the
    connectivity registry every chat edit already goes through — a
    manually-drawn edge into the wrong side of a load balancer is
    rejected exactly like an LLM-proposed one would be) and the exact
    same _finalize path, so a manual edit produces a real versioned,
    diffed, ADR'd change indistinguishable in the history from a chat
    edit — just a different origin for the same validated commands. This
    is what makes "the LLM never draws the diagram directly" apply
    equally to a human drawing it directly.

    `base_version_id=None` is "build from a genuinely blank project" — a
    brand-new project has no version at all until something creates the
    first one (page.tsx's handleCreateProject deliberately doesn't
    auto-create a blank one — see its own comment), so the very first
    manual add_node needs to originate from empty_state() with no parent,
    the same starting point a project's first chat-proposed architecture
    already uses."""
    if not commands:
        return ChatTurnResult(kind="error", error="no commands to apply")

    if base_version_id is None:
        current_state = empty_state()
        parent_id: UUID | None = None
    else:
        base_version = await repo.get_version(base_version_id)
        if base_version is None or base_version["project_id"] != project_id:
            return ChatTurnResult(kind="error", error="base_version_id not found")
        current_state = _state_from_row(base_version)
        parent_id = base_version["id"]

    result = apply_commands(current_state, commands)
    if not result.ok:
        return ChatTurnResult(kind="error", error="; ".join(e.error for e in result.errors))

    assert result.state is not None
    # No diff against an empty_state() starting point -- everything in
    # the very first manual add_node is "added", not a meaningful
    # comparison, so this matches build_templated_decision's own "kind of
    # change" framing rather than reporting deltas against nothing.
    if parent_id is None:
        summary = "Started the architecture manually."
    else:
        diff = diff_states(current_state, result.state)
        templated = build_templated_decision(diff)
        summary = templated[0] if templated else "No changes."
    return await _finalize(project_id, current_state, result.state, parent_id, "initial" if parent_id is None else "edit", summary, model_provided_decision=False)
