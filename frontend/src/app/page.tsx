"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, Boxes, Gauge, MessageSquare } from "lucide-react";
import { AnalyzerPanel } from "@/components/AnalyzerPanel";
import { ArchitectureCanvas } from "@/components/ArchitectureCanvas";
import { ChatPanel } from "@/components/ChatPanel";
import { ComparePanel } from "@/components/ComparePanel";
import { SimulationPanel } from "@/components/SimulationPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Spinner, Tabs } from "@/components/ui";
import { VersionHistory } from "@/components/VersionHistory";
import type { Project } from "@/lib/api";
import { api } from "@/lib/api";
import { buildDiffDisplayState } from "@/lib/diffView";
import { computeIncrementalLayout } from "@/lib/incrementalLayout";
import { computeDagreLayout, type LayoutMap } from "@/lib/layout";
import type { ArchitectureState, ChatMessage, CompareResult, SimulationResult, VersionDiff, VersionRow } from "@/lib/types";

const STORAGE_KEY = "ai-architect-project-id";
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

  const [busy, setBusy] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const existing = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        let project: Project;
        if (existing) {
          project = await api.getProject(existing);
        } else {
          const created = await api.createProject("New Project");
          localStorage.setItem(STORAGE_KEY, created.id);
          project = { ...created, latest_version: null };
        }
        setProjectId(project.id);

        if (project.latest_version) {
          setLatestVersionId(project.latest_version.id);
          await loadVersion(project.id, project.latest_version.id, project.latest_version);
        }
      } catch (e) {
        setInitError(e instanceof Error ? e.message : String(e));
      } finally {
        setInitializing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadVersion(pid: string, versionId: string, preloaded?: VersionRow) {
    const version = preloaded ?? (await api.getVersion(pid, versionId));
    let layout = version.layout;
    if (!layout || Object.keys(layout).length === 0) {
      layout = computeDagreLayout(version.state);
      api.updateLayout(pid, versionId, layout).catch(() => {});
    }

    let versionDiff: VersionDiff | null = null;
    if (version.parent_version_id) {
      try {
        versionDiff = await api.getDiff(pid, versionId);
      } catch {
        versionDiff = null;
      }
    }

    setCompareResult(null);
    setSimulationResult(null); // stale for a different version's graph
    setGhostLayoutHint({}); // no in-memory hint when jumping to an arbitrary version
    setRawState(version.state);
    setRawLayout(layout);
    setDiff(versionDiff);
    setActiveVersionId(versionId);
  }

  async function handleSend(message: string) {
    if (!projectId) return;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setBusy(true);
    try {
      // Edits and tier requests both branch off whatever's currently active
      // (spec §6 Phase 3: tiers are siblings off a shared base, not a chain).
      const result = await api.sendChatMessage(projectId, message, activeVersionId);
      if (result.kind === "question") {
        setMessages((prev) => [...prev, { role: "assistant", content: result.question }]);
      } else if (result.kind === "architecture") {
        setMessages((prev) => [...prev, { role: "assistant", content: result.summary }]);

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
        setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${result.error}` }]);
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setBusy(false);
    }
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
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ Could not compare versions: ${e instanceof Error ? e.message : String(e)}` }]);
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
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:shadow-black/20">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/30">
              <Boxes size={17} />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">AI Architect</h1>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
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
            <div className="flex w-[380px] shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
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
                        projectId={projectId}
                        versionId={activeVersionId}
                        state={rawState}
                        result={simulationResult}
                        onResult={setSimulationResult}
                        onExit={() => setMode("chat")}
                      />
                    ) : (
                      <ChatPanel messages={messages} onSend={handleSend} busy={busy || !projectId} />
                    )}
                  </div>
                </>
              )}
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
                <ArchitectureCanvas state={displayState} layout={displayLayout} diff={displayDiff} simulation={displaySimulation} />
              </div>
            </div>

            {projectId && (
              <div className="w-[240px] shrink-0 border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <VersionHistory
                  projectId={projectId}
                  activeVersionId={activeVersionId}
                  refreshKey={versionsRefreshKey}
                  onSelect={(vid) => loadVersion(projectId, vid)}
                  onCompare={handleCompare}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
