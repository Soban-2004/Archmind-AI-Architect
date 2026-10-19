"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useParams, useRouter } from "next/navigation";
import { Activity, ArrowLeft, Boxes, ChevronLeft, ChevronRight, Gauge, History, MessageSquare, Zap } from "lucide-react";
import { AnalyzerPanel } from "@/components/AnalyzerPanel";
import { ArchitectureCanvas } from "@/components/ArchitectureCanvas";
import { BrandMark } from "@/components/BrandMark";
import { ChatPanel } from "@/components/ChatPanel";
import { ComparePanel } from "@/components/ComparePanel";
import { ImportRepoScreen } from "@/components/ImportRepoScreen";
import { Landing } from "@/components/Landing";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { SimulationPanel } from "@/components/SimulationPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IconButton, Spinner, Tabs } from "@/components/ui";
import { VersionHistory } from "@/components/VersionHistory";
import type { Project } from "@/lib/api";
import { api } from "@/lib/api";
import { buildDiffDisplayState } from "@/lib/diffView";
import { computeIncrementalLayout } from "@/lib/incrementalLayout";
import { computeDagreLayout, type LayoutMap } from "@/lib/layout";
import { normalizeVersionEvidence } from "@/lib/types";
import { requestErrorMessage } from "@/lib/requestError";
import type { ArchitectureState, ChatMessage, ChatResponse, CompareResult, IngestResponse, MutationCommand, SimulationResult, VersionDiff, VersionEvidence, VersionRow } from "@/lib/types";

type MobileView = "workspace" | "canvas" | "history";
const STORAGE_KEY = "ai-architect-project-id";
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 640;
const HISTORY_WIDTH = 240;
const HISTORY_RAIL_WIDTH = 44;
type Mode = "chat" | "analyze" | "simulate";
// "landing"/"import" are the pre-project entry flow (Landing.tsx,
// ImportRepoScreen.tsx) — "app" is the existing full editor. Always
// defaults to "landing" on the bare "/" route, even for a returning
// visitor with a project remembered in localStorage — the landing page is
// the front door there, not just on a first visit. The remembered project
// (if any) still loads silently in the background (see the mount effect
// below) so Landing's "Continue" link is instant, not a second network
// round trip. A visit to /project/[projectId] instead skips landing
// entirely and opens straight into "app" — see the routeProjectId effect.
type View = "landing" | "import" | "app";

/** Fill in positions dagre-fresh for any node the known layout doesn't
 * cover (e.g. ghost nodes when browsing history/compare with no in-memory
 * hint) — known positions always win, this only patches gaps. */
function ensureFullLayout(state: ArchitectureState, known: LayoutMap): LayoutMap {
  const missing = state.nodes.some((n) => !known[n.id]);
  if (!missing) return known;
  return { ...computeDagreLayout(state), ...known };
}

/** The whole app — landing, import, and the full editor — behind one
 * component so both routes that render it (the bare "/" and
 * "/project/[projectId]") share every bit of state-management logic.
 * Which project (if any) is open lives in the URL now, not just in
 * memory: this reads its starting project id straight from the route via
 * useParams(), so the same component works unchanged on both routes —
 * bookmarking, refreshing, and the browser's back/forward button all do
 * the right thing without either page file needing its own logic. */
export function AppShell() {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useParams<{ projectId?: string }>();
  const routeProjectId = typeof routeParams?.projectId === "string" ? routeParams.projectId : null;

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<Mode>("chat");
  const [initializing, setInitializing] = useState(true);
  const [view, setView] = useState<View>("landing");

  const [rawState, setRawState] = useState<ArchitectureState | null>(null);
  const [rawLayout, setRawLayout] = useState<LayoutMap>({});
  // positions of nodes as of just before the last live edit — used only to
  // place ghost (removed) nodes accurately; cleared when browsing history.
  const [ghostLayoutHint, setGhostLayoutHint] = useState<LayoutMap>({});
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  // The active version's real, persisted source citations (backend/app/db/
  // schema.sql's `evidence` column) — empty for every chat/manual-edit
  // version, populated for one that came from a real repo import. Kept in
  // lockstep with rawState/rawLayout, set at every one of the same call
  // sites those are (loadVersion, handleSend's architecture branch,
  // handleNodeSave, handleApplyCommands).
  const [versionEvidence, setVersionEvidence] = useState<VersionEvidence>({ evidence: [], citations: {} });

  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [latestVersionId, setLatestVersionId] = useState<string | null>(null);
  // Mirrors activeVersionId for handleRunSimulation's stale-response guard
  // below — a ref, not the state itself, because it needs to be read
  // inside an already-in-flight async callback without that callback
  // capturing a now-outdated closure value. Kept in sync by the effect
  // right after activeVersionId's own declaration-adjacent effects.
  const activeVersionIdRef = useRef<string | null>(null);
  const [versionsRefreshKey, setVersionsRefreshKey] = useState(0);
  // Quick undo/redo for edits made from THIS browser tab (chat edits,
  // manual canvas edits, node-detail saves) — not a separate mutation, just
  // a client-side stack of version ids to jump back/forward through via
  // the same loadVersion() the version-history panel already uses. Every
  // edit is already a real, persisted version (see _finalize choke point
  // server-side), so "undo" never destroys anything — it's exactly the
  // same as clicking the parent version in history, just one keystroke.
  // Manually browsing history (clicking an arbitrary version there)
  // clears both stacks rather than trying to splice into them — jumping
  // to an arbitrary point breaks the "one step back/forward" assumption
  // this pair only makes sense under.
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  const [compareResult, setCompareResult] = useState<{ result: CompareResult; state: ArchitectureState; layout: LayoutMap } | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  // Simulation controls — lifted here rather than owned by SimulationPanel
  // because the dock living in the canvas (ArchitectureCanvas) and the
  // results list in the sidebar (SimulationPanel) both need to read/write
  // the same multiplier/kill-set/running state.
  const [simMultiplier, setSimMultiplier] = useState(1);
  const [simKillIds, setSimKillIds] = useState<string[]>([]);
  const [simRunning, setSimRunning] = useState(false);
  const [simPlaying, setSimPlaying] = useState(true); // pauses/resumes the particle animation, not the data
  const [simError, setSimError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  // Real live pipeline-stage text for the current chat turn (see
  // ChatPanel's ThinkingBubble) — set from each "stage" SSE event as it
  // actually arrives, cleared between turns so a stale stage never lingers.
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [layoutSaveStatus, setLayoutSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const layoutSaveSequence = useRef(0);
  const failedLayoutSave = useRef<{ projectId: string; versionId: string; layout: LayoutMap } | null>(null);
  const projectLoadSequence = useRef(0);
  const versionLoadSequence = useRef(0);
  const currentProjectRef = useRef<string | null>(null);
  const retryProjectAction = useRef<(() => Promise<void>) | null>(null);
  // True while handleCreateProject/handleSwitchProject's real network
  // round trip is in flight — surfaced on Landing's buttons (disabled +
  // a spinner) so a slow response (a cold Render instance waking up, in
  // particular) reads as "working on it" instead of looking frozen and
  // inviting a rage-click. Doesn't cover handleImportSuccess — that only
  // ever runs after ImportRepoScreen's own import already finished, with
  // the new version already in hand, so there's nothing slow left to wait
  // on by the time it's called.
  const [projectActionPending, setProjectActionPending] = useState(false);
  // Which project id handleSwitchProject is currently loading, specifically
  // — lets ProjectSwitcher show a spinner on THAT one row instead of just
  // a generic "something is happening" state across the whole list.
  const [switchingToId, setSwitchingToId] = useState<string | null>(null);
  // Sum of real (not estimated) token usage across every LLM call this
  // browser session has made — resets on reload, like Claude Code's own
  // session status line. A turn the deterministic Tier-1 fast path
  // handled has no LLM usage to add, which is correct: it used none.
  const [sessionTokens, setSessionTokens] = useState(0);
  const [lastTurnTokens, setLastTurnTokens] = useState(0);

  const [panelWidth, setPanelWidth] = useState(340);
  const [historyCollapsed, setHistoryCollapsed] = useState(true);
  // Below `md` the three-pane layout (chat / canvas / history) can't just
  // shrink — there's no room for even two of them side by side — so it
  // becomes one panel at a time, switched here, instead of the desktop
  // row. Desktop ignores this entirely (its own always-visible layout).
  const [mobileView, setMobileView] = useState<MobileView>("workspace");
  const appRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizingRef.current || !appRef.current) return;
      const rect = appRef.current.getBoundingClientRect();
      setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, e.clientX - rect.left)));
    }
    function onUp() {
      resizingRef.current = false;
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startResizing() {
    resizingRef.current = true;
    document.body.style.cursor = "col-resize";
  }

  useEffect(() => {
    // Only the bare "/" route falls back to a remembered project from
    // localStorage — a visit to /project/[projectId] already names the
    // project explicitly and is handled by the effect below instead, so
    // this one bails out immediately rather than racing it.
    setInitializing(false);
    if (routeProjectId) return;
    let existing: string | null = null;
    try { existing = localStorage.getItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
    if (!existing) return;
    (async () => {
      try {
        const project = await api.getProject(existing);
        await openProject(project);
      } catch (error) {
        setInitError(requestErrorMessage(error, "Couldn’t reopen your project"));
        retryProjectAction.current = () => handleSwitchProject(existing);
      }
    })();
    // Deliberately run once on mount only — openProject is a fresh
    // function reference every render, and re-running this on every
    // reference change would re-trigger project loading in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Drives /project/[projectId]: fires on first load of that route (a
    // bookmark, a shared link someone opened, a fresh tab) AND whenever
    // routeProjectId itself changes (browser back/forward between two
    // different projects' URLs, which Next's router updates without a
    // full remount). Already-loaded is the common case — openProject
    // below pushes this exact route itself right after setting projectId,
    // so most firings here just confirm the view instead of re-fetching.
    if (!routeProjectId || routeProjectId === projectId) {
      if (routeProjectId) setView("app");
      return;
    }
    (async () => {
      try {
        const project = await api.getProject(routeProjectId);
        await openProject(project);
        setView("app");
      } catch (error) {
        // Doesn't exist, or belongs to a different guest token than this
        // browser's — same 404 either way (see repository.py's owner_token
        // grandfather clause), so there's nothing more specific to tell
        // the user here. Bounce to the project list rather than stranding
        // them on a dead route.
        setInitError(requestErrorMessage(error, "Couldn’t open this project"));
        retryProjectAction.current = () => handleSwitchProject(routeProjectId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId]);

  /** Loads a project as the active one — used on first load, and by the
   * project switcher. Restores the persisted conversation and resets
   * transient per-project state. History failures remain retryable.
   * Also keeps the URL in sync: pushes /project/[id] if it isn't already
   * the current route, so every entry point that opens a project (the
   * switcher, "+ New", import, a direct /project/[id] visit) ends up at
   * the same, real, bookmarkable URL.
   *
   * Deliberately does NOT clear rawState/activeVersionId/latestVersionId
   * up front when there's a real version to load — found live: switching
   * between two already-open projects used to clear rawState to null
   * immediately, which made ArchitectureCanvas fall through to its "no
   * architecture yet" empty state for the brief gap before loadVersion
   * repopulated it, reading as "flashes back to the landing page" even
   * though it never actually left the app view. The old project's diagram
   * now stays on screen, unchanged, until the new one is actually ready
   * to replace it — loadVersion below sets rawState/layout/etc. together,
   * in one commit, so there's no intermediate empty frame to see. Only a
   * genuinely version-less project (a brand-new one) clears them, which
   * is the correct moment to show the empty state — there's really
   * nothing to display yet. */
  async function openProject(project: Project) {
    const loadSequence = ++projectLoadSequence.current;
    let history: ChatMessage[] = [];
    let failedHistory = false;
    try {
      history = (await api.getMessages(project.id)).map((message) => ({ role: message.role, content: message.content, createdAt: message.created_at }));
    } catch { failedHistory = true; }
    if (loadSequence !== projectLoadSequence.current) return;
    currentProjectRef.current = project.id;
    try { localStorage.setItem(STORAGE_KEY, project.id); } catch { /* Keep the current session usable. */ }
    setProjectId(project.id);
    setProjectName(project.name);
    setMessages(history);
    setBusy(false);
    setBusyStage(null);
    setHistoryError(failedHistory);
    setInitError(null);
    setMode("chat");
    setCompareResult(null);
    setSimulationResult(null);
    setSessionTokens(0);
    setUndoStack([]);
    setRedoStack([]);

    const targetPath = `/project/${project.id}`;
    if (pathname !== targetPath) router.push(targetPath);

    if (project.latest_version) {
      setLatestVersionId(project.latest_version.id);
      await loadVersion(project.id, project.latest_version.id, project.latest_version);
    } else {
      setActiveVersionId(null);
      setLatestVersionId(null);
      setRawState(null);
      setRawLayout({});
      setLayoutSaveStatus("saved");
      setGhostLayoutHint({});
      setVersionEvidence({ evidence: [], citations: {} });
      setDiff(null);
    }
  }

  async function handleSwitchProject(id: string) {
    if (id === projectId && !initError) return;
    setInitError(null);
    retryProjectAction.current = () => handleSwitchProject(id);
    setProjectActionPending(true);
    setSwitchingToId(id);
    try {
      const project = await api.getProject(id);
      await openProject(project);
      setView("app");
    } catch (e) {
      setInitError(requestErrorMessage(e, "Couldn’t open the project"));
    } finally {
      setProjectActionPending(false);
      setSwitchingToId(null);
    }
  }

  async function retryConversationHistory() {
    if (!projectId) return;
    const targetId = projectId;
    setHistoryLoading(true);
    try {
      const history = await api.getMessages(targetId);
      if (currentProjectRef.current !== targetId) return;
      setMessages(history.map((message) => ({ role: message.role, content: message.content, createdAt: message.created_at })));
      setHistoryError(false);
    } catch {
      if (currentProjectRef.current === targetId) setHistoryError(true);
    } finally { setHistoryLoading(false); }
  }

  async function handleCreateProject() {
    setInitError(null);
    retryProjectAction.current = handleCreateProject;
    setProjectActionPending(true);
    try {
      const created = await api.createProject("New Project");
      await openProject({ ...created, latest_version: null });
      setView("app");
    } catch (e) {
      setInitError(requestErrorMessage(e, "Couldn’t create the project"));
    } finally {
      setProjectActionPending(false);
    }
  }

  /** ProjectSwitcher's "+ New" and the post-delete-active-project fallback
   * both land here now, instead of instant-creating a blank project —
   * the landing screen's own "start a new project" is one click further,
   * so this doesn't cost a returning user anything, and it means "+ New"
   * and a genuine first visit are the same one entry flow instead of two
   * that could drift apart. Also navigates back to the bare "/" route, so
   * the URL matches what's on screen even if we got here from a
   * /project/[id] page. */
  function handleShowLanding() {
    setInitError(null);
    // Found live: navigating from /project/[id] to "/" unmounts and
    // remounts AppShell (a different route segment, so every piece of
    // component state — including projectId itself — resets) — which
    // re-runs the mount effect that silently reopens whatever project
    // localStorage still remembers, bouncing straight back into it about
    // a second later (the round trip of that background api.getProject
    // call). An explicit "go home" click has to actually clear that, not
    // just change what's on screen right now, or the remount undoes it.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
    setView("landing");
    if (pathname !== "/") router.push("/");
  }

  /** ImportRepoScreen's success handler — the backend already created and
   * persisted the real project + reconstructed version by this point
   * (services/ingestion.py's persist_ingestion), so this is just wiring
   * the already-real result into the same openProject path every other
   * entry point uses, then switching to the editor. */
  async function handleImportSuccess(result: IngestResponse) {
    if (!result.project || !result.version) return;
    await openProject({ id: result.project.id, name: result.project.name, created_at: result.project.created_at, latest_version: result.version });
    setView("app");
  }

  /** Call right before switching to a newly-created version as the result
   * of a real edit (chat, manual canvas, node-detail save) — pushes the
   * version being left onto the undo stack and clears redo (a fresh edit
   * always invalidates whatever "forward" history existed, same as any
   * editor's undo/redo). Not called when just browsing version history,
   * which resets both stacks instead (see undoStack's declaration). */
  function recordEdit() {
    if (activeVersionId) setUndoStack((prev) => [...prev, activeVersionId]);
    setRedoStack([]);
  }

  /** Jump to an arbitrary version from the history panel — distinct from
   * handleUndo/handleRedo below even though both end up calling
   * loadVersion, because this one resets the undo/redo stacks instead of
   * consuming them (see undoStack's declaration for why). */
  async function handleSelectVersionFromHistory(versionId: string) {
    if (!projectId) return;
    if (await loadVersion(projectId, versionId)) {
      setUndoStack([]);
      setRedoStack([]);
    }
  }

  async function handleUndo() {
    if (!projectId || undoStack.length === 0) return;
    const targetId = undoStack[undoStack.length - 1];
    const leavingId = activeVersionId;
    if (await loadVersion(projectId, targetId)) {
      setUndoStack((prev) => prev.slice(0, -1));
      if (leavingId) setRedoStack((prev) => [...prev, leavingId]);
    }
  }

  async function handleRedo() {
    if (!projectId || redoStack.length === 0) return;
    const targetId = redoStack[redoStack.length - 1];
    const leavingId = activeVersionId;
    if (await loadVersion(projectId, targetId)) {
      setRedoStack((prev) => prev.slice(0, -1));
      if (leavingId) setUndoStack((prev) => [...prev, leavingId]);
    }
  }

  async function loadVersion(pid: string, versionId: string, preloaded?: VersionRow) {
    const loadSequence = ++versionLoadSequence.current;
    let version: VersionRow;
    try { version = preloaded ?? await api.getVersion(pid, versionId); }
    catch (error) {
      if (currentProjectRef.current === pid && loadSequence === versionLoadSequence.current) {
        setInitError(requestErrorMessage(error, "Couldn’t open this version"));
        retryProjectAction.current = async () => { await loadVersion(pid, versionId); };
      }
      return false;
    }
    if (currentProjectRef.current !== pid || loadSequence !== versionLoadSequence.current) return false;
    setInitError(null);
    let layout = version.layout;
    if (!layout || Object.keys(layout).length === 0) {
      layout = computeDagreLayout(version.state);
      api.updateLayout(pid, versionId, layout).catch(() => {});
    }

    setCompareResult(null);
    setSimulationResult(null); // stale for a different version's graph
    setGhostLayoutHint({}); // no in-memory hint when jumping to an arbitrary version
    setRawState(version.state);
    setRawLayout(layout);
    setLayoutSaveStatus("saved");
    setVersionEvidence(normalizeVersionEvidence(version.evidence));
    // No diff here — this just loads a version's actual current state, not
    // a "what changed" view. `diff` (and its removed-node ghosts) is only
    // ever set right after a live edit in handleSend, and explicitly via
    // the Compare panel. Setting it here too used to mean reloading the
    // page, or clicking any version in history, permanently showed
    // whatever that version's most recent edit had removed — a removed
    // node that's still visible, with the simulator having no idea it
    // exists, isn't "the design", it's a leftover from the last edit.
    setDiff(null);
    setActiveVersionId(versionId);
    return true;
  }

  async function handleSend(message: string) {
    if (!projectId || busy) return false;
    const sendingProjectId = projectId;
    setMessages((prev) => [...prev, { role: "user", content: message, createdAt: new Date().toISOString() }]);
    setBusy(true);
    setBusyStage(null);
    try {
      // Edits and tier requests both branch off whatever's currently active
      // (spec §6 Phase 3: tiers are siblings off a shared base, not a chain).
      // Streamed rather than a single await — each "stage" event updates
      // busyStage with the REAL pipeline step as it actually starts
      // (services/interview.py's OnStage), not a client-side guess; the
      // final "result" event carries the exact same payload shape the
      // plain (non-streaming) endpoint returns, so everything below this
      // point is unchanged from before streaming existed.
      let result: ChatResponse | null = null;
      for await (const event of api.sendChatMessageStream(projectId, message, activeVersionId)) {
        if (event.type === "stage") { if (currentProjectRef.current === sendingProjectId) setBusyStage(event.stage); }
        else result = event.payload;
      }
      if (!result) throw new Error("The response stream ended without a result.");
      if (currentProjectRef.current !== sendingProjectId) return false;

      if (result.usage) {
        setSessionTokens((t) => t + result.usage!.total_tokens);
        setLastTurnTokens(result.usage.total_tokens);
      }
      if (result.kind === "question") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.question, quickReplies: result.quick_replies, reasoning: result.reasoning, animate: true, createdAt: new Date().toISOString() },
        ]);
      } else if (result.kind === "answer") {
        // Non-mutating reply (a question/recommendation answer or a
        // what-if narration) — append it to the chat log only. Nothing
        // else changes: no new version, no diff, no layout recompute.
        // `sources` is only ever present for a web-grounded advisory
        // answer (see intent_router.py's needs_web_grounding).
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.answer, sources: result.sources, animate: true, createdAt: new Date().toISOString() },
        ]);
      } else if (result.kind === "architecture") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.summary, reasoning: result.reasoning, animate: true, createdAt: new Date().toISOString() },
        ]);

        const isTier = result.version.kind === "tier";
        // A tier is a fresh generation (unrelated node ids), not an
        // incremental edit — carrying "positions" forward from a
        // structurally different graph would be meaningless, so it gets a
        // clean dagre layout instead of the incremental placement.
        const newLayout = isTier
          ? computeDagreLayout(result.version.state)
          : computeIncrementalLayout(rawState, rawLayout, result.version.state);
        api.updateLayout(projectId, result.version.id, newLayout).catch(() => {});

        setGhostLayoutHint(isTier ? {} : rawLayout);
        setRawState(result.version.state);
        setRawLayout(newLayout);
        setVersionEvidence(normalizeVersionEvidence(result.version.evidence));
        setDiff(result.diff);
        setSimulationResult(null); // stale now that the graph changed
        recordEdit();
        setActiveVersionId(result.version.id);
        setLatestVersionId(result.version.id);
        setVersionsRefreshKey((k) => k + 1);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${result.error}`, animate: true, createdAt: new Date().toISOString() }]);
        return false;
      }
      return true;
    } catch (e) {
      if (currentProjectRef.current !== sendingProjectId) return false;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `${requestErrorMessage(e, "Couldn’t send your message")} Your draft has been saved.`, createdAt: new Date().toISOString() },
      ]);
      return false;
    } finally {
      if (currentProjectRef.current === sendingProjectId) {
        setBusy(false);
        setBusyStage(null);
      }
    }
  }

  /** Direct node edit from the canvas (NodeDetailCard's edit mode) — no
   * chat round-trip, no LLM call. Mirrors handleSend's "architecture"
   * branch (new version, incremental layout, diff overlay, chat-visible
   * summary) since it goes through the identical apply/finalize path
   * server-side, just triggered by a UI action instead of a message.
   * Errors are re-thrown so NodeDetailCard's own save button can show
   * them inline instead of silently failing. */
  async function handleNodeSave(nodeId: string, attributes: Record<string, unknown>) {
    if (!projectId || !activeVersionId) return;
    const result = await api.updateNode(projectId, activeVersionId, nodeId, attributes);
    const newLayout = computeIncrementalLayout(rawState, rawLayout, result.version.state);
    api.updateLayout(projectId, result.version.id, newLayout).catch(() => {});

    setGhostLayoutHint(rawLayout);
    setRawState(result.version.state);
    setRawLayout(newLayout);
    setVersionEvidence(normalizeVersionEvidence(result.version.evidence));
    setDiff(result.diff);
    setSimulationResult(null); // stale now that the graph changed
    recordEdit();
    setActiveVersionId(result.version.id);
    setLatestVersionId(result.version.id);
    setVersionsRefreshKey((k) => k + 1);
    setMessages((prev) => [...prev, { role: "assistant", content: result.summary, animate: true }]);
  }

  /** Manual canvas edits — the add-component palette, drag-to-connect,
   * delete node/edge — one or several MutationCommands from a single user
   * action, going through the exact same apply/finalize path as
   * handleNodeSave/handleSend, just a different origin for the commands.
   * Errors are re-thrown so the calling UI (ArchitectureCanvas's own
   * handlePaletteAdd, the edge-delete confirm card, NodeDetailCard's
   * delete confirm) can show them inline.
   * No activeVersionId is a real, valid state here (not "nothing to do
   * yet") — a genuinely brand-new project has no version at all until the
   * first one exists, so the very first manual add_node has to start the
   * project from scratch via the dedicated new-project endpoint. */
  async function handleApplyCommands(commands: MutationCommand[]) {
    if (!projectId) return;
    const result = activeVersionId
      ? await api.applyCommands(projectId, activeVersionId, commands)
      : await api.applyCommandsToNewProject(projectId, commands);
    const newLayout = computeIncrementalLayout(rawState, rawLayout, result.version.state);
    api.updateLayout(projectId, result.version.id, newLayout).catch(() => {});

    setGhostLayoutHint(rawLayout);
    setRawState(result.version.state);
    setRawLayout(newLayout);
    setVersionEvidence(normalizeVersionEvidence(result.version.evidence));
    setDiff(result.diff);
    setSimulationResult(null); // stale now that the graph changed
    recordEdit();
    setActiveVersionId(result.version.id);
    setLatestVersionId(result.version.id);
    setVersionsRefreshKey((k) => k + 1);
    setMessages((prev) => [...prev, { role: "assistant", content: result.summary, animate: true }]);
  }

  async function persistLayout(targetProjectId: string, targetVersionId: string, layout: LayoutMap, sequence: number) {
    setLayoutSaveStatus("saving");
    try {
      await api.updateLayout(targetProjectId, targetVersionId, layout);
      if (sequence === layoutSaveSequence.current) {
        failedLayoutSave.current = null;
        setLayoutSaveStatus("saved");
      }
    } catch {
      if (sequence === layoutSaveSequence.current) {
        failedLayoutSave.current = { projectId: targetProjectId, versionId: targetVersionId, layout };
        setLayoutSaveStatus("error");
      }
    }
  }

  function handleRetryLayoutSave() {
    const failed = failedLayoutSave.current;
    if (!failed) return;
    const sequence = ++layoutSaveSequence.current;
    void persistLayout(failed.projectId, failed.versionId, failed.layout, sequence);
  }

  function handleNodePositionsChange(updates: LayoutMap) {
    // Only the live editable graph persists drags — a compare snapshot has
    // no single version id of its own to write a layout onto here.
    if (!projectId || !activeVersionId || compareResult) return;
    const targetProjectId = projectId;
    const targetVersionId = activeVersionId;
    const next = { ...rawLayout, ...updates };
    const sequence = ++layoutSaveSequence.current;
    setRawLayout(next);
    void persistLayout(targetProjectId, targetVersionId, next, sequence);
  }

  // Simulation runs client-side only against the currently loaded graph —
  // the chat agent never sees a run's results unless handed them
  // explicitly. This is that hand-off: switch to chat and send the
  // findings as an edit request, so the same agent that designed the
  // architecture is what proposes the fix, not advice typed outside the
  // product.
  function handleFixInChat(message: string) {
    setMode("chat");
    void handleSend(message);
  }

  function handleConsumeAnimation(index: number) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, animate: false } : m)));
  }

  // Accepts explicit overrides rather than only reading simMultiplier/
  // simKillIds from closure — a caller that just called setSimMultiplier
  // or setSimKillIds this same tick can't rely on that state having
  // updated yet (React state updates aren't synchronous), so passing the
  // new value straight through is what actually avoids running against
  // the stale, pre-update value.
  async function handleRunSimulation(overrideMultiplier?: number, overrideKillIds?: string[]) {
    if (!projectId || !activeVersionId) return;
    // Captured now, compared against activeVersionIdRef.current once this
    // resolves — more than one of these can legitimately be in flight at
    // once (a fast edit can start a new run before a previous version's
    // is done), and without this guard the one that happens to resolve
    // LAST would win regardless of whether it's actually for the version
    // still on screen. Found live: this used to silently apply a stale
    // result for a version the user had already moved past.
    const targetVersionId = activeVersionId;
    setSimRunning(true);
    setSimError(null);
    try {
      const r = await api.simulate(projectId, targetVersionId, overrideMultiplier ?? simMultiplier, overrideKillIds ?? simKillIds);
      if (targetVersionId !== activeVersionIdRef.current) return; // superseded by a newer edit while this was in flight
      setSimulationResult(r);
      setSimPlaying(true);
    } catch (e) {
      if (targetVersionId !== activeVersionIdRef.current) return;
      setSimError(e instanceof Error ? e.message : String(e));
    } finally {
      if (targetVersionId === activeVersionIdRef.current) setSimRunning(false);
    }
  }

  /** Toggling a kill from the canvas (click a node -> Kill/Revive, see
   * NodeDetailCard) re-runs immediately with the new set so the diagram
   * feels live. */
  function handleToggleKill(nodeId: string) {
    const next = simKillIds.includes(nodeId) ? simKillIds.filter((x) => x !== nodeId) : [...simKillIds, nodeId];
    setSimKillIds(next);
    if (simulationResult) void handleRunSimulation(undefined, next);
  }

  /** Adjusting the multiplier while a result is already showing re-runs
   * immediately too — it used to just update the dial with no visible
   * effect at all until Stop + Play again, since Play only toggles pause
   * once a result exists. */
  function handleMultiplierChange(m: number) {
    setSimMultiplier(m);
    if (simulationResult) void handleRunSimulation(m);
  }

  function handlePlayPause() {
    if (!simulationResult) {
      void handleRunSimulation();
      return;
    }
    setSimPlaying((p) => !p);
  }

  function handleStopSimulation() {
    setSimulationResult(null);
    setSimKillIds([]);
    setSimError(null);
    setSimPlaying(true);
  }

  useEffect(() => {
    activeVersionIdRef.current = activeVersionId;
  }, [activeVersionId]);

  // Live by default: the simulation dock lives permanently on the canvas
  // now (not gated behind switching to the Simulate tab — see the
  // simDock prop below), so it runs a baseline scenario the moment a
  // version is actually loaded, independent of whichever sidebar tab is
  // open. Only fires once there's nothing to show yet; Stop clearing the
  // result does not auto-restart itself, which is the correct read of a
  // deliberate Stop.
  //
  // Deliberately does NOT also skip while simRunning is true (a previous
  // fix here did, and it was a real bug — found live): editing faster
  // than one simulate() round trip (quick palette adds/removes in a row)
  // meant the PREVIOUS version's request was still "running" when the
  // NEW version's activeVersionId arrived, so that guard silently
  // blocked the new version from ever being simulated — the dock just
  // sat there showing stale or no data. Now this always kicks off a
  // fresh run for whatever activeVersionId just became current;
  // handleRunSimulation's own stale-response guard (see its
  // targetVersionId check) makes it safe for more than one to be in
  // flight at once — only the response matching the CURRENT
  // activeVersionId at resolution time is ever applied.
  useEffect(() => {
    if (compareResult) return;
    if (simulationResult) return;
    if (!projectId || !activeVersionId) return;
    void handleRunSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, activeVersionId]);

  async function handleCompare(versionAId: string, versionBId: string) {
    if (!projectId) return;
    const targetProjectId = projectId;
    try {
      const [result, versionB] = await Promise.all([api.compare(projectId, versionAId, versionBId), api.getVersion(projectId, versionBId)]);
      if (currentProjectRef.current !== targetProjectId) return;
      let layout = versionB.layout;
      if (!layout || Object.keys(layout).length === 0) {
        layout = computeDagreLayout(versionB.state);
      }
      setCompareResult({ result, state: versionB.state, layout });
    } catch (e) {
      if (currentProjectRef.current === targetProjectId) {
        setInitError(requestErrorMessage(e, "Couldn’t compare these versions"));
        retryProjectAction.current = () => handleCompare(versionAId, versionBId);
      }
    }
  }

  /** Builds a link to the read-only shared view (src/app/shared/[projectId]/
   * [versionId]/page.tsx) for the currently active version and copies it —
   * there's no access-control layer to set up here (this app has none at
   * all today, every id is already reachable via the plain API), so
   * "sharing" is just handing out a URL to a real, already-public route
   * that happens to render read-only instead of the full editor. */
  function handleCopyShareLink() {
    if (!projectId || !activeVersionId) return "";
    const url = `${window.location.origin}/shared/${projectId}/${activeVersionId}`;
    return url;
  }

  const displayState = useMemo(() => {
    if (compareResult) return buildDiffDisplayState(compareResult.state, compareResult.result.diff);
    return rawState ? buildDiffDisplayState(rawState, diff) : null;
  }, [compareResult, rawState, diff]);

  const displayLayout = useMemo(() => {
    if (!displayState) return {};
    const known = compareResult ? compareResult.layout : { ...ghostLayoutHint, ...rawLayout };
    return ensureFullLayout(displayState, known);
  }, [displayState, compareResult, ghostLayoutHint, rawLayout]);

  const displayDiff = compareResult ? compareResult.result.diff : diff;
  const displaySimulation = compareResult ? null : simulationResult; // simulation overlays the live graph only, not a compare snapshot

  const viewingHistorical = !compareResult && activeVersionId !== null && activeVersionId !== latestVersionId;

  return (
    <div className="h-dvh bg-background p-0 sm:p-3">
      <div ref={appRef} className="app-frame flex h-full flex-col overflow-hidden border border-slate-200 bg-surface dark:border-slate-800">
        <header
          className="app-header relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-surface px-4 dark:border-slate-800 dark:bg-surface"
        >
          <div className="flex items-center gap-2">
            {view === "landing" ? (
              <BrandMark size={32} />
            ) : (
              // Wired to actually go home — found live: the logo mark reads
              // as a clickable "back to start" affordance (it's the one
              // fixed anchor in every corner of the app), but nothing here
              // ever navigated anywhere. Only shown once there's actually
              // somewhere else to go (not on the landing screen itself).
              <button
                onClick={handleShowLanding}
                title="Back to projects"
                className="rounded-[10px_10px_10px_3px] transition hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-background"
              >
                <BrandMark size={32} />
              </button>
            )}
            <div className="leading-tight">
              {view === "app" ? (
                <>
                  <ProjectSwitcher
                    projectId={projectId}
                    projectName={projectName || "AI Architect"}
                    onSwitch={handleSwitchProject}
                    onCreate={handleShowLanding}
                    onRename={(id, name) => { if (id === projectId) setProjectName(name); }}
                    switchingToId={switchingToId}
                  />
                  <p className="px-2 text-[11px] text-slate-400 dark:text-slate-500">
                    {viewingHistorical ? "editing will branch from here" : latestVersionId ? "editing latest version" : "new project"}
                  </p>
                </>
              ) : (
                // No switcher/"+ New" chrome on the landing or import
                // screens — the whole page is already "start something
                // new or pick a path in," so a project-switcher control
                // (whose own dropdown offers "+ New" again) is pure
                // redundancy here, not a real affordance. Found live.
                <p className="px-2 font-display text-sm font-semibold text-slate-800 dark:text-slate-100">ArchMind</p>
              )}
            </div>
          </div>
          <ThemeToggle />
        </header>

        {initError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200"><span>{initError}</span><div className="flex gap-4"><button disabled={projectActionPending} onClick={() => void retryProjectAction.current?.()} className="font-semibold underline">{projectActionPending ? "Retrying…" : "Retry"}</button><button onClick={() => { setInitError(null); if (routeProjectId !== projectId) router.replace(projectId ? `/project/${projectId}` : "/"); }} className="underline">Dismiss</button></div></div>}
        {initializing ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-400 dark:text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : view === "landing" ? (
          <div className="flex min-h-0 flex-1">
            <Landing
              onNewProject={handleCreateProject}
              onImportRepo={() => setView("import")}
              busy={projectActionPending}
              existingProject={projectId ? { id: projectId, name: projectName || "Untitled project" } : null}
              onContinue={() => {
                setView("app");
                if (projectId && pathname !== `/project/${projectId}`) router.push(`/project/${projectId}`);
              }}
            />
          </div>
        ) : view === "import" ? (
          <div className="flex min-h-0 flex-1">
            <ImportRepoScreen onSuccess={handleImportSuccess} onCancel={() => setView("landing")} />
          </div>
        ) : (
          (() => {
            // Shared between the desktop three-pane row and the mobile
            // one-panel-at-a-time view below, so the two layouts can
            // never drift into showing different content for the same
            // state — only the chrome around them differs.
            const workspacePanel = compareResult ? (
              <div key="compare" className="flex min-h-0 flex-1 animate-fade-in flex-col">
                <ComparePanel result={compareResult.result} onExit={() => setCompareResult(null)} />
              </div>
            ) : (
              <>
                {activeVersionId && (
                  <div className="border-b border-slate-200 p-2.5 dark:border-slate-800">
                    <Tabs
                      active={mode}
                      onChange={setMode}
                      tabs={[
                        { id: "chat", label: "Chat", icon: <MessageSquare size={13} /> },
                        { id: "analyze", label: "Analyze", icon: <Gauge size={13} /> },
                        { id: "simulate", label: "Simulate", icon: <Activity size={13} /> },
                      ]}
                    />
                  </div>
                )}
                <div key={mode} className="min-h-0 flex-1 animate-fade-in">
                  {mode === "analyze" && projectId && activeVersionId ? (
                    <AnalyzerPanel projectId={projectId} versionId={activeVersionId} onExit={() => setMode("chat")} onFixInChat={handleFixInChat} />
                  ) : mode === "simulate" && projectId && activeVersionId && rawState ? (
                    <SimulationPanel
                      state={rawState}
                      result={simulationResult}
                      killIds={simKillIds}
                      onToggleKill={handleToggleKill}
                      error={simError}
                      onExit={() => setMode("chat")}
                      onFixInChat={handleFixInChat}
                    />
                  ) : (
                    <ChatPanel key={projectId} projectId={projectId ?? ""} hasArchitecture={!!rawState} historyError={historyError} onRetryHistory={() => void retryConversationHistory()} messages={messages} onSend={handleSend} busy={busy || historyLoading || !projectId} busyStage={busyStage} onConsumeAnimation={handleConsumeAnimation} />
                  )}
                </div>
              </>
            );

            const canvasPanel = (
              <>
                {viewingHistorical && (
                  <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                    <span>Viewing an earlier version. New edits will branch off from here.</span>
                    {latestVersionId && projectId && (
                      <button className="flex items-center gap-1 font-medium underline" onClick={() => handleSelectVersionFromHistory(latestVersionId)}>
                        <ArrowLeft size={12} /> Back to latest
                      </button>
                    )}
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <ArchitectureCanvas
                    state={displayState}
                    layout={displayLayout}
                    diff={displayDiff}
                    simulation={displaySimulation}
                    onNodePositionsChange={compareResult ? undefined : handleNodePositionsChange}
                    onNodeSave={compareResult ? undefined : handleNodeSave}
                    onApplyCommands={compareResult ? undefined : handleApplyCommands}
                    onUndo={compareResult ? undefined : handleUndo}
                    onRedo={compareResult ? undefined : handleRedo}
                    canUndo={!compareResult && undoStack.length > 0}
                    canRedo={!compareResult && redoStack.length > 0}
                    busy={!compareResult && busy}
                    projectName={projectName}
                    onShare={!compareResult && activeVersionId ? handleCopyShareLink : undefined}
                    projectId={!compareResult && projectId ? projectId : undefined}
                    versionId={!compareResult && activeVersionId ? activeVersionId : undefined}
                    evidence={compareResult ? undefined : versionEvidence}
                    onStartChat={!compareResult ? () => { setMode("chat"); setMobileView("workspace"); } : undefined}
                    layoutSaveStatus={!compareResult && activeVersionId ? layoutSaveStatus : undefined}
                    onRetryLayoutSave={!compareResult ? handleRetryLayoutSave : undefined}
                    simDock={
                      // Permanently on the canvas, not gated behind opening
                      // the Simulate tab — the sidebar tab is now only for
                      // the detailed findings report, not for whether the
                      // dock itself exists.
                      !compareResult
                        ? {
                            multiplier: simMultiplier,
                            onMultiplierChange: handleMultiplierChange,
                            playing: simPlaying,
                            onPlayPause: handlePlayPause,
                            onStop: handleStopSimulation,
                            running: simRunning,
                            killIds: simKillIds,
                            onToggleKill: handleToggleKill,
                          }
                        : undefined
                    }
                  />
                </div>
              </>
            );

            const historyPanel = projectId && (
              <VersionHistory
                key={projectId}
                projectId={projectId}
                activeVersionId={activeVersionId}
                refreshKey={versionsRefreshKey}
                onSelect={handleSelectVersionFromHistory}
                onCompare={handleCompare}
              />
            );

            const mobileTabs: { id: MobileView; label: string; icon: ReactNode }[] = [
              { id: "workspace", label: "Chat", icon: <MessageSquare size={13} /> },
              { id: "canvas", label: "Canvas", icon: <Boxes size={13} /> },
              ...(projectId ? [{ id: "history" as const, label: "History", icon: <History size={13} /> }] : []),
            ];

            return (
              <>
                {/* Desktop / tablet: chat, canvas, and history all
                    visible at once, side by side. Unchanged from before —
                    the mobile view below is a fully separate layout, not
                    a squeeze of this one. */}
                <div className="hidden min-h-0 flex-1 lg:flex">
                  <div style={{ width: panelWidth }} className="flex shrink-0 flex-col border-r border-slate-200 bg-surface dark:border-slate-800">
                    {workspacePanel}
                  </div>

                  {/* Drag handle to resize the left panel */}
                  <div
                    onMouseDown={startResizing}
                    className="group relative w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-brand-400 dark:bg-slate-800 dark:hover:bg-brand-500"
                  >
                    <div className="absolute inset-y-0 -left-1 -right-1" />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">{canvasPanel}</div>

                  {projectId && (
                    <div
                      style={{ width: historyCollapsed ? HISTORY_RAIL_WIDTH : HISTORY_WIDTH }}
                      className="relative shrink-0 border-l border-slate-200 bg-surface transition-[width] duration-200 dark:border-slate-800"
                    >
                      <IconButton
                        onClick={() => setHistoryCollapsed((v) => !v)}
                        className="absolute -left-3.5 top-3.5 z-10 h-7 w-7 bg-surface shadow-soft dark:bg-slate-800"
                        title={historyCollapsed ? "Show history" : "Hide history"}
                      >
                        {historyCollapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                      </IconButton>
                      {!historyCollapsed && historyPanel}
                    </div>
                  )}
                </div>

                {/* Mobile: one panel at a time — there's no room to show
                    even two of chat/canvas/history side by side below
                    `md`, so the three-pane row above is replaced entirely
                    (not shrunk) by a switcher over a single full-width
                    panel. */}
                <div className="flex min-h-0 flex-1 flex-col lg:hidden">
                  <div className="border-b border-slate-200 p-2 dark:border-slate-800">
                    <Tabs active={mobileView} onChange={setMobileView} tabs={mobileTabs} />
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    {mobileView === "workspace" ? workspacePanel : mobileView === "canvas" ? canvasPanel : historyPanel}
                  </div>
                </div>
              </>
            );
          })()
        )}

        {sessionTokens > 0 && (
          <div className="flex h-6 shrink-0 items-center justify-end gap-1.5 border-t border-slate-200 bg-slate-50 px-3 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-surface/60 dark:text-slate-500">
            <Zap size={10} />
            {lastTurnTokens.toLocaleString()} last turn · {sessionTokens.toLocaleString()} cumulative LLM tokens
          </div>
        )}
      </div>
    </div>
  );
}
