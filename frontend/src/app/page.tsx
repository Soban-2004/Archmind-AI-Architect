"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, Boxes, ChevronLeft, ChevronRight, Gauge, MessageSquare, Zap } from "lucide-react";
import { AnalyzerPanel } from "@/components/AnalyzerPanel";
import { ArchitectureCanvas } from "@/components/ArchitectureCanvas";
import { ChatPanel } from "@/components/ChatPanel";
import { ComparePanel } from "@/components/ComparePanel";
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
import type { ArchitectureState, ChatMessage, CompareResult, SimulationResult, VersionDiff, VersionRow } from "@/lib/types";

const STORAGE_KEY = "ai-architect-project-id";
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 640;
const HISTORY_WIDTH = 240;
const HISTORY_RAIL_WIDTH = 44;
type Mode = "chat" | "analyze" | "simulate";

/** Fill in positions dagre-fresh for any node the known layout doesn't
 * cover (e.g. ghost nodes when browsing history/compare with no in-memory
 * hint) — known positions always win, this only patches gaps. */
function ensureFullLayout(state: ArchitectureState, known: LayoutMap): LayoutMap {
  const missing = state.nodes.some((n) => !known[n.id]);
  if (!missing) return known;
  return { ...computeDagreLayout(state), ...known };
}

export default function Home() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<Mode>("chat");
  const [initializing, setInitializing] = useState(true);

  const [rawState, setRawState] = useState<ArchitectureState | null>(null);
  const [rawLayout, setRawLayout] = useState<LayoutMap>({});
  // positions of nodes as of just before the last live edit — used only to
  // place ghost (removed) nodes accurately; cleared when browsing history.
  const [ghostLayoutHint, setGhostLayoutHint] = useState<LayoutMap>({});
  const [diff, setDiff] = useState<VersionDiff | null>(null);

  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [latestVersionId, setLatestVersionId] = useState<string | null>(null);
  const [versionsRefreshKey, setVersionsRefreshKey] = useState(0);

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
  const [initError, setInitError] = useState<string | null>(null);
  // Sum of real (not estimated) token usage across every LLM call this
  // browser session has made — resets on reload, like Claude Code's own
  // session status line. A turn the deterministic Tier-1 fast path
  // handled has no LLM usage to add, which is correct: it used none.
  const [sessionTokens, setSessionTokens] = useState(0);

  const [panelWidth, setPanelWidth] = useState(380);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
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
    (async () => {
      try {
        const existing = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        let project: Project;
        if (existing) {
          project = await api.getProject(existing);
        } else {
          const created = await api.createProject("New Project");
          project = { ...created, latest_version: null };
        }
        await openProject(project);
      } catch (e) {
        setInitError(e instanceof Error ? e.message : String(e));
      } finally {
        setInitializing(false);
      }
    })();
    // Deliberately run once on mount only — openProject is a fresh
    // function reference every render, and re-running this on every
    // reference change would re-trigger project creation/loading in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Loads a project as the active one — used on first load, and by the
   * project switcher. Resets every piece of per-project state (chat
   * transcript included: the backend keeps the real message history, but
   * this app has never reloaded it into the UI on open, same gap that
   * already exists on a plain page refresh — switching projects isn't
   * introducing a new inconsistency, just inheriting an existing one). */
  async function openProject(project: Project) {
    localStorage.setItem(STORAGE_KEY, project.id);
    setProjectId(project.id);
    setProjectName(project.name);
    setMessages([]);
    setMode("chat");
    setCompareResult(null);
    setSimulationResult(null);
    setSessionTokens(0);
    setActiveVersionId(null);
    setLatestVersionId(null);
    setRawState(null);
    setRawLayout({});
    setGhostLayoutHint({});
    setDiff(null);

    if (project.latest_version) {
      setLatestVersionId(project.latest_version.id);
      await loadVersion(project.id, project.latest_version.id, project.latest_version);
    }
  }

  async function handleSwitchProject(id: string) {
    if (id === projectId) return;
    try {
      const project = await api.getProject(id);
      await openProject(project);
    } catch (e) {
      setInitError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCreateProject() {
    try {
      const created = await api.createProject("New Project");
      await openProject({ ...created, latest_version: null });
    } catch (e) {
      setInitError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadVersion(pid: string, versionId: string, preloaded?: VersionRow) {
    const version = preloaded ?? (await api.getVersion(pid, versionId));
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
  }

  async function handleSend(message: string) {
    if (!projectId) return;
    setMessages((prev) => [...prev, { role: "user", content: message, createdAt: new Date().toISOString() }]);
    setBusy(true);
    try {
      // Edits and tier requests both branch off whatever's currently active
      // (spec §6 Phase 3: tiers are siblings off a shared base, not a chain).
      const result = await api.sendChatMessage(projectId, message, activeVersionId);
      if (result.kind !== "error" && result.usage) {
        setSessionTokens((t) => t + result.usage!.total_tokens);
      }
      if (result.kind === "question") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.question, quickReplies: result.quick_replies, animate: true, createdAt: new Date().toISOString() },
        ]);
      } else if (result.kind === "architecture") {
        setMessages((prev) => [...prev, { role: "assistant", content: result.summary, animate: true, createdAt: new Date().toISOString() }]);

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
        setDiff(result.diff);
        setSimulationResult(null); // stale now that the graph changed
        setActiveVersionId(result.version.id);
        setLatestVersionId(result.version.id);
        setVersionsRefreshKey((k) => k + 1);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${result.error}`, animate: true, createdAt: new Date().toISOString() }]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : String(e)}`, animate: true, createdAt: new Date().toISOString() },
      ]);
    } finally {
      setBusy(false);
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
    setDiff(result.diff);
    setSimulationResult(null); // stale now that the graph changed
    setActiveVersionId(result.version.id);
    setLatestVersionId(result.version.id);
    setVersionsRefreshKey((k) => k + 1);
    setMessages((prev) => [...prev, { role: "assistant", content: result.summary, animate: true }]);
  }

  function handleNodePositionsChange(updates: LayoutMap) {
    // Only the live editable graph persists drags — a compare snapshot has
    // no single version id of its own to write a layout onto here.
    if (!projectId || !activeVersionId || compareResult) return;
    setRawLayout((prev) => {
      const next = { ...prev, ...updates };
      api.updateLayout(projectId, activeVersionId, next).catch(() => {});
      return next;
    });
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

  async function handleRunSimulation(overrideKillIds?: string[]) {
    if (!projectId || !activeVersionId) return;
    setSimRunning(true);
    setSimError(null);
    try {
      const r = await api.simulate(projectId, activeVersionId, simMultiplier, overrideKillIds ?? simKillIds);
      setSimulationResult(r);
      setSimPlaying(true);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : String(e));
    } finally {
      setSimRunning(false);
    }
  }

  /** Toggling a kill from the canvas (click a node -> Kill/Revive, see
   * NodeDetailCard) re-runs immediately with the new set so the diagram
   * feels live — unlike the multiplier, which you'd normally adjust a few
   * times before caring about the result, killing a specific node is
   * itself the thing you want to see the effect of right away. */
  function handleToggleKill(nodeId: string) {
    const next = simKillIds.includes(nodeId) ? simKillIds.filter((x) => x !== nodeId) : [...simKillIds, nodeId];
    setSimKillIds(next);
    if (simulationResult) void handleRunSimulation(next);
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

  async function handleCompare(versionAId: string, versionBId: string) {
    if (!projectId) return;
    try {
      const [result, versionB] = await Promise.all([api.compare(projectId, versionAId, versionBId), api.getVersion(projectId, versionBId)]);
      let layout = versionB.layout;
      if (!layout || Object.keys(layout).length === 0) {
        layout = computeDagreLayout(versionB.state);
      }
      setCompareResult({ result, state: versionB.state, layout });
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Could not compare versions: ${e instanceof Error ? e.message : String(e)}`, createdAt: new Date().toISOString() },
      ]);
    }
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
    <div className="h-screen bg-background p-3">
      <div ref={appRef} className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:shadow-black/20">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/30">
              <Boxes size={17} />
            </div>
            <div className="leading-tight">
              <ProjectSwitcher
                projectId={projectId}
                projectName={projectName || "AI Architect"}
                onSwitch={handleSwitchProject}
                onCreate={handleCreateProject}
              />
              <p className="px-2 text-[11px] text-slate-400 dark:text-slate-500">
                {viewingHistorical ? "editing will branch from here" : latestVersionId ? "editing latest version" : "new project"}
              </p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        {initError ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-red-600 dark:text-red-400">
            Could not reach the backend at NEXT_PUBLIC_API_URL: {initError}
          </div>
        ) : initializing ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-400 dark:text-slate-500">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div style={{ width: panelWidth }} className="flex shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {compareResult ? (
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
                      <AnalyzerPanel projectId={projectId} versionId={activeVersionId} onExit={() => setMode("chat")} />
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
                      <ChatPanel messages={messages} onSend={handleSend} busy={busy || !projectId} onConsumeAnimation={handleConsumeAnimation} />
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Drag handle to resize the left panel */}
            <div
              onMouseDown={startResizing}
              className="group relative w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-brand-400 dark:bg-slate-800 dark:hover:bg-brand-500"
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              {viewingHistorical && (
                <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                  <span>Viewing an earlier version. New edits will branch off from here.</span>
                  {latestVersionId && projectId && (
                    <button className="flex items-center gap-1 font-medium underline" onClick={() => loadVersion(projectId, latestVersionId)}>
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
                  busy={!compareResult && busy}
                  simDock={
                    !compareResult && mode === "simulate"
                      ? {
                          multiplier: simMultiplier,
                          onMultiplierChange: setSimMultiplier,
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
            </div>

            {projectId && (
              <div
                style={{ width: historyCollapsed ? HISTORY_RAIL_WIDTH : HISTORY_WIDTH }}
                className="relative shrink-0 border-l border-slate-200 bg-white transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-900"
              >
                <IconButton
                  onClick={() => setHistoryCollapsed((v) => !v)}
                  className="absolute -left-3.5 top-3.5 z-10 h-7 w-7 border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
                  title={historyCollapsed ? "Show history" : "Hide history"}
                >
                  {historyCollapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                </IconButton>
                {!historyCollapsed && (
                  <VersionHistory
                    projectId={projectId}
                    activeVersionId={activeVersionId}
                    refreshKey={versionsRefreshKey}
                    onSelect={(vid) => loadVersion(projectId, vid)}
                    onCompare={handleCompare}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {sessionTokens > 0 && (
          <div className="flex h-6 shrink-0 items-center justify-end gap-1.5 border-t border-slate-200 bg-slate-50 px-3 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-500">
            <Zap size={10} />
            {sessionTokens.toLocaleString()} tokens used this session
          </div>
        )}
      </div>
    </div>
  );
}
