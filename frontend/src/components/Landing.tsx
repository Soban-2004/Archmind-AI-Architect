"use client";

import { ArrowRight, Boxes, FolderUp, GitCompare, MessageSquare, ShieldCheck, Waves } from "lucide-react";

interface Props {
  onNewProject: () => void;
  onImportRepo: () => void;
  busy?: boolean;
}

const FEATURES = [
  { icon: ShieldCheck, label: "Every change validated", detail: "The AI never draws the diagram directly — it only emits commands checked against real structural rules before anything is applied." },
  { icon: GitCompare, label: "Fully versioned", detail: "Every edit, tier, and import is a real version you can browse, diff, and branch from — nothing overwrites silently." },
  { icon: Waves, label: "Simulated, not assumed", detail: "See which components would actually buckle under 10x traffic or a killed dependency, before it happens for real." },
];

/**
 * The one thing this app never had until now: a moment where a new
 * visitor is told what this is and given two deliberate paths in, rather
 * than silently landing in an empty chat box someone else already
 * populated with a blank "New Project". Shown once, on a genuinely first
 * visit (no project remembered yet) — and re-openable any time via
 * ProjectSwitcher's "+ New", not something a returning user has to fight
 * through again just to keep working.
 */
export function Landing({ onNewProject, onImportRepo, busy }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-3xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <Boxes size={28} />
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-slate-900 dark:text-slate-100">AI Architect</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Describe a system, or point at one you&apos;ve already built — get a real, structured architecture back, not
            just a picture. Every component the AI proposes is checked against real rules before it ever reaches the
            canvas.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            onClick={onNewProject}
            disabled={busy}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md disabled:pointer-events-none disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/40"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-indigo-500/15 dark:text-indigo-300">
              <MessageSquare size={18} />
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                Start a new project
                <ArrowRight size={13} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-slate-600" />
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Describe what you want to build in plain language. A short interview turns it into a real, editable
                architecture in minutes.
              </p>
            </div>
          </button>

          <button
            onClick={onImportRepo}
            disabled={busy}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md disabled:pointer-events-none disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/40"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400">
              <FolderUp size={18} />
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                Import an existing repo
                <ArrowRight size={13} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-slate-600" />
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Upload a codebase and reconstruct its real architecture from actual evidence — imports, routes,
                docker-compose services — not a guess.
              </p>
            </div>
          </button>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-3 dark:border-slate-800">
          {FEATURES.map(({ icon: Icon, label, detail }) => (
            <div key={label} className="flex items-start gap-2.5">
              <Icon size={15} className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
              <div>
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
