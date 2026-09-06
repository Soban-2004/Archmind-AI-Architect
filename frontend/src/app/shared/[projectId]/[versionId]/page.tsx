"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Boxes, ExternalLink } from "lucide-react";
import { ArchitectureCanvas } from "@/components/ArchitectureCanvas";
import { ThemeToggle } from "@/components/ThemeToggle";
import { EmptyState, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { computeDagreLayout, type LayoutMap } from "@/lib/layout";
import type { ArchitectureState } from "@/lib/types";

/**
 * The read-only half of "export/share" — no auth layer to build (this app
 * has none at all today; every id is already reachable through the plain
 * API), so this is just a real route that renders a version without any
 * of the editor's controls: no chat, no history, no node editing, no
 * simulation dock. A viewer who wasn't handed the link has no way to
 * *find* this URL, but anyone who has it can always open it — the same
 * property a typical "anyone with the link can view" doc share has.
 */
export default function SharedVersionPage() {
  const params = useParams<{ projectId: string; versionId: string }>();
  const [state, setState] = useState<ArchitectureState | null>(null);
  const [layout, setLayout] = useState<LayoutMap>({});
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [project, version] = await Promise.all([
          api.getProject(params.projectId),
          api.getVersion(params.projectId, params.versionId),
        ]);
        if (cancelled) return;
        setProjectName(project.name);
        setState(version.state);
        setLayout(version.layout && Object.keys(version.layout).length > 0 ? version.layout : computeDagreLayout(version.state));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.projectId, params.versionId]);

  return (
    <div className="h-screen bg-background p-3">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:shadow-black/20">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/30">
              <Boxes size={17} />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{projectName || "AI Architect"}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Shared, read-only</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Open AI Architect <ExternalLink size={11} />
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {error ? (
            <EmptyState icon={<Boxes size={22} />} title="Couldn't load this diagram" description={error} />
          ) : loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400 dark:text-slate-500">
              <Spinner className="h-4 w-4" /> Loading…
            </div>
          ) : (
            <ArchitectureCanvas state={state} layout={layout} projectName={projectName} />
          )}
        </div>
      </div>
    </div>
  );
}
