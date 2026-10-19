# ArchMind product and workflow review

Reviewed 2026-10-14. Scope: current repository, backend tests, isolated mutation-engine probes, and previously completed real database/browser checks. This review changes no application behavior.

## Product assessment

ArchMind has a useful core: describe or import a system, inspect a deterministic graph, revise it through validated commands, compare versions, explore capacity, and export a starting point. Its strongest potential is helping developers make and explain architecture decisions. Developers and architecture learners are the working audience assumption; this is not a user-research finding.

The next investment should be trust and completion of this decision workflow. Adding more modes before closing correctness gaps would increase the number of outputs users must interpret without improving confidence in them.

## Validation and limits

- Ran the full backend suite: **263 passed in 8.64 seconds**.
- Independently reproduced three accepted invalid updates in `apply_commands`: invalid service type, changed node ID with an existing edge still referencing the old ID, and duplicate node name.
- Previously verified project creation, transcript restoration, draft recovery, owner isolation, retries, rename, and clipboard denial against real FastAPI/PostgreSQL and a browser.
- Sharing, race conditions, archive limits, and persistence concerns below are based on code inspection unless explicitly described as reproduced.
- The configured normal backend previously failed to start because its Supabase hostname did not resolve. This review does not establish current hosted-database availability or validate live AI output quality. Passing offline tests does not establish production readiness.

## Workflow assessment

| Workflow | What works | Gap and recommended behavior |
|---|---|---|
| Start a design | Chat interview and manual creation use the same architecture representation. | Show a persistent editable requirements brief: users, workload, budget, availability, exclusions, and unanswered questions. Separate declared facts from defaults. |
| Import a repository | Deterministic discovery and source citations provide traceability. | Show a coverage review before acceptance: detected services, missing configuration, unsupported files, inferred elements, and selected source revision. Preserve provenance through subsequent edits. |
| Revise architecture | Chat and manual actions create versions; historical editing branches. | Preview significant AI changes before applying. Summarize removed components, constraint changes, and expected cost/capacity effects. Make branch identity explicit. |
| Analyze and fix | Findings can be sent to the architect. | After applying a fix, rerun the relevant rule and show resolved, unchanged, or new findings. An applied change is not proof the issue is fixed. |
| Simulate | Deterministic capacity propagation and failure controls; UI already identifies the model as heuristic. | Save named scenarios, expose assumptions, compare the same scenario across versions, and distinguish estimates from measurements. |
| Compare alternatives | Structural diff and explanation already exist. | Compare budget, findings, capacity, assumptions, and unmet requirements alongside graph changes. Let the user choose a preferred baseline. |
| Return to a project | Persisted versions and conversation restoration exist. | Restore the selected version/branch, surface save status, and provide guest identity recovery or optional account claiming. |
| Share and hand off | Read-only route and starter-kit export exist. | Implement a genuine revocable share capability. Export constraints, risks, assumptions, citations, and explicit unsupported implementation steps. |

## Engineering priorities

### P0: repair the architecture integrity boundary

`backend/app/services/mutation_engine.py:76` and `:123` use `model_copy(update=...)` for validation and application. Updated values are not validated. The independent probes accepted `type='invalid_type'`, `id='changed_id'`, and a duplicate name.

Allow only editable fields, prohibit ID/discriminator changes, validate a merged dictionary with the concrete node schema, then validate graph-wide invariants. Recheck incident edges when node attributes affect connection rules. Add regression tests proving the whole batch fails atomically and leaves the parent unchanged. Official Pydantic documentation confirms the copy behavior: https://github.com/pydantic/pydantic/blob/main/docs/concepts/models.md#model-copy.

### P1: make sharing match the product promise

`frontend/src/app/shared/[projectId]/[versionId]/page.tsx:36` fetches the ordinary owner-scoped project and version endpoints. A different browser supplies a different guest token and cannot read a token-owned project. The page comment claiming anyone with the link can open it predates owner isolation.

Create a separate read-only share token scoped to a version, with revocation and optional expiry. Do not put the owner's guest token in the URL or remove owner checks. Expose only the intended snapshot; conversation and unrelated project versions should remain private. Verify with two isolated browser contexts.

### P1: preserve a stable identity when storage is blocked

`frontend/src/lib/guestToken.ts:33` returns a new UUID on each request if localStorage throws, without assigning it to the module cache. Creation can use token A and the immediately following read token B. This is more severe than losing ownership after reload.

Cache one in-memory token in the failure path. Then add a way to claim guest projects into an optional account or recover access through an explicit recovery mechanism. Explain persistence limits where users save valuable work.

### P1: protect asynchronous writes and results

`handleNodeSave` and `handleApplyCommands` in `AppShell.tsx:560` and `:590` update current state after awaiting without checking whether the project or version changed. Unlike chat, these paths lack a project-result guard. A slow edit may finish after switching projects. Simulation at `:657` checks the version, but two runs on the same version with different inputs can still resolve out of order.

Guard results by project, base version, and monotonic request ID. For simulation, include scenario identity. Serialize conflicting edits or handle expected-head conflicts explicitly while allowing intentional branches. Test delayed responses, reversed completion order, project switches, and rapid scenario changes.

### P1: make finalization atomic and retries safe

`backend/app/services/interview.py:322` writes version, ADRs, message linkage, and assistant message through separate repository operations. A failure after version insertion can report an error despite a saved architecture. Retrying may create another version. Chat streaming also cancels the task when the stream closes; no durable operation record communicates the final outcome.

Use one database transaction for finalization and a client request ID with an idempotent operation record. Represent pending, complete, failed, and cancelled operations. On reconnect, check the outcome rather than blindly resubmitting. Keep slow provider calls outside the short database transaction.

### P1: expose persistence failures

`AppShell.tsx` discards layout-save errors with `.catch(() => {})`, including the drag path at `:617`. The graph can look saved while positions are lost on reload; concurrent complete-layout writes can overwrite newer positions.

Queue/coalesce layout saves per version, show Saving/Saved/Save failed, retain the latest unsaved layout, and retry safely. Treat graph-state persistence and layout persistence as separate statuses where necessary.

### P1: resolve blocking review findings deliberately

`backend/app/services/interview.py:734` retries blocking judge findings only while attempts remain, then falls through to finalization on the last attempt. Judge exceptions also allow generation to proceed. This makes review advisory in practice even when the finding is called blocking.

Reject unresolved blocking findings, or save an explicitly unapproved draft requiring user review. Distinguish structural validation passed, AI review passed, review unavailable, and review failed. Never imply an unavailable second opinion succeeded.

### P1: bound archive expansion and upload memory

The import route caps compressed bytes, but `file.read()` reads the upload before that check and `extractall()` has no total expanded-byte, file-count, or per-file cap. A small compressed archive can create a large processing workload. This is a static finding; no abusive archive was executed.

Enforce upload limits while reading and enforce file-count and expanded-byte limits during extraction. Use path-aware containment checks, explicit archive-member policy, and a bounded import job. Verify that oversized or unsupported archives fail before LLM work begins.

### P2: preserve provenance and make version history intentional

`_finalize` creates edited versions without passing evidence, while the repository defaults evidence to an empty object. Imports retain citations in the reconstruction version, but subsequent edits lose that evidence in the current snapshot. `get_latest_version` chooses the newest creation timestamp rather than an explicit preferred branch head. The conversation UI loads the flat project log, although the model uses branch-scoped history.

Carry citations for unchanged nodes, mark edited evidence stale, and distinguish observed from proposed nodes. Persist an explicit selected/preferred head and show a branch tree with branch-aware conversation. Undo currently navigates local version stacks; define separately whether Restore makes a historical version the current baseline.

## Feature roadmap

1. **Requirements and assumptions workspace.** Structured, editable constraints with provenance, unresolved questions, and node/decision links. Provides a shared source of truth for generation, analysis, and comparison.
2. **Preview, apply, and verify changes.** Show proposed diffs, accept/reject meaningful changes, and verify requested outcomes after application. Keep quick deterministic edits lightweight.
3. **Saved scenario comparison.** Name traffic/failure scenarios; use identical inputs to compare alternatives; show bottlenecks, budget impact, and assumptions. Current capacity propagation is not a measured load test and treats cycles as best effort.
4. **Decision-ready comparison and export.** A report covering requirements, tradeoffs, unresolved risks, cost basis, citations, scenario results, and implementation gaps. Reuse existing ADRs rather than inventing a parallel decision store.
5. **Reliable sharing and project recovery.** Version-scoped share links first; optional accounts and project claiming next. Add comments/approval only after ownership and permissions are solid.
6. **Repository drift detection.** Pin import provenance to a commit, reimport later, compare observed architecture with the previous snapshot, and review changes before applying. Private-repository integration is a later expansion, not a prerequisite.

Prioritize 1–4 around one complete decision workflow. Collaboration, broad cloud pricing integrations, and more animation should follow evidence of repeated use.

## Suggested delivery sequence and acceptance criteria

**First: integrity and recovery.** Fix invalid mutations, unstable guest identity, cross-project responses, persistence visibility, and transaction/idempotency behavior. Invalid updates never persist; a failed/retried request produces at most one completed operation; stale results never change another project or scenario.

**Second: finish existing promises.** Make sharing work across browsers, retain import provenance, make judge status honest, and verify analyzer fixes. A revoked share fails; a non-owner cannot modify or read private data; a fix is called resolved only after the rule passes.

**Third: improve decisions.** Add the structured brief, proposal review, named scenarios, and a decision report. Users should be able to explain why a design meets their requirements and identify what remains uncertain.

Track first useful architecture completion, time to a reviewed decision, abandonments at each step, failed/retried operations, saved-work recovery, verified-fix rate, successful cross-browser shares, and return use. Establish a baseline before choosing numeric targets. Node count and generated-version count alone are weak success metrics.
