"use client";

import { ArrowRight, FolderUp, GitCompare, Layers, MessageSquare, ScanSearch, ShieldCheck, Sparkles, Wallet, Waves } from "lucide-react";
import { HeroDiagram } from "./HeroDiagram";

interface Props {
  onNewProject: () => void;
  onImportRepo: () => void;
  busy?: boolean;
}

const HOW_IT_WORKS = [
  {
    step: "STEP 01 / INPUT",
    title: "Describe or import",
    detail: "Say what you're building in plain language, or point at a repo you've already shipped.",
  },
  {
    step: "STEP 02 / VALIDATE",
    title: "Every change, checked",
    detail: "The AI never draws the diagram itself — it proposes commands, and each one is checked against real structural rules first.",
  },
  {
    step: "STEP 03 / VERIFY",
    title: "Simulate, score, ship",
    detail: "See what breaks under 10x traffic, get a deterministic scorecard, export or share the result.",
  },
];

// Real capabilities, not aspirational marketing copy — every line here
// maps to something this session actually built and live-verified (see
// README): scale-aware cost.py v2, Phase 3 tiering, the simulator,
// registry validation, Phase 5 evidence grounding, and the Analyzer's
// citation-checked Q&A.
const FEATURES = [
  { icon: ShieldCheck, label: "Structurally validated", detail: "Bad edge directions, duplicate nodes, and bypassed load balancers are rejected before they reach the canvas." },
  { icon: GitCompare, label: "Fully versioned", detail: "Every edit, tier, and import is a real version — browse, diff, and branch from any point in history." },
  { icon: Waves, label: "Simulated, not assumed", detail: "A deterministic capacity model shows which components buckle first under real load or a killed dependency." },
  { icon: Wallet, label: "Cost tied to real load", detail: "Instance counts — and the monthly estimate — scale from actual simulated traffic against declared capacity, not a flat guess per component type." },
  { icon: Layers, label: "Tiered alternatives", detail: "Ask for a $0 student version or a production tier for 1M users and get a fresh, constraint-grounded architecture, not a resize." },
  { icon: ScanSearch, label: "Evidence-grounded imports", detail: "Reconstructing an existing repo cites the exact import, route, or compose file behind every proposed component." },
  { icon: Sparkles, label: "Deterministic where it counts", detail: "Scores, diffs, and capacity math are computed by rules, not the model — re-running them never changes the answer." },
  { icon: MessageSquare, label: "Grounded explanations", detail: "Ask why a score is what it is and get an answer that can only cite findings that actually fired." },
];

/**
 * A "blueprint" identity, not the templated purple-gradient SaaS hero —
 * IBM Plex type (engineering-drawing lineage, not the usual Inter/Space
 * Grotesk) and a schematic vocabulary (grid backdrop, annotated plate,
 * drafting-sheet corner ticks) that's actually specific to a system-
 * validation tool. Scoped entirely to this component's own bp-* tokens
 * (globals.css) — the rest of the app keeps its existing brand- and
 * slate-based palette and Geist type untouched.
 *
 * Shown once, on a genuinely first visit (no project remembered yet) —
 * and re-openable any time via ProjectSwitcher's "+ New". Deliberately no
 * fabricated trust signals (no invented testimonials, user counts, or
 * logos) — HeroDiagram is a real, live animated preview of the product's
 * own simulation technique, not a stock illustration or a static screenshot.
 */
export function Landing({ onNewProject, onImportRepo, busy }: Props) {
  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-bp-paper font-plex-sans text-bp-ink">
      {/* Blueprint grid backdrop — fades out before the "how it works"
          section so it reads as a hero treatment, not wallpaper for the
          whole page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[640px] opacity-[0.55]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-bp-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-bp-line) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "linear-gradient(to bottom, black, black 60%, transparent 96%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, black 60%, transparent 96%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-5xl px-7 py-10">
        {/* --- Hero ------------------------------------------------------ */}
        <div className="grid grid-cols-1 items-center gap-14 pt-6 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-bp-line-strong px-3 py-1 font-plex-mono text-[11px] uppercase tracking-wide text-bp-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-bp-good shadow-[0_0_0_3px_rgba(5,150,105,0.2)]" />
              AI-native system design
            </span>

            <h1 className="mt-5 text-[2.6rem] font-bold leading-[1.05] tracking-tight text-balance sm:text-5xl">
              System architecture,
              <br />
              <span className="text-bp-accent">actually validated.</span>
            </h1>

            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-bp-muted">
              Describe a system, or point at one you&apos;ve already built. Every component the AI proposes is checked
              against real structural rules before it ever reaches the diagram — it never just draws a pretty
              picture and hopes.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={onNewProject}
                disabled={busy}
                className="group flex items-center justify-center gap-2 rounded-lg bg-bp-accent px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-bp-accent/25 transition hover:-translate-y-0.5 hover:shadow-xl disabled:pointer-events-none disabled:opacity-50"
              >
                <MessageSquare size={15} /> Start a new project
                <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
              </button>
              <button
                onClick={onImportRepo}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-lg border border-bp-line-strong bg-bp-surface px-5 py-3.5 text-sm font-semibold text-bp-ink shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
              >
                <FolderUp size={15} /> Import an existing repo
              </button>
            </div>
            <p className="mt-3.5 font-plex-mono text-[10.5px] tracking-wide text-bp-muted">
              NO ACCOUNT REQUIRED — STRAIGHT INTO EITHER FLOW
            </p>
          </div>

          <div className="animate-fade-in">
            <HeroDiagram />
          </div>
        </div>

        {/* --- How it works ---------------------------------------------- */}
        <div className="mt-16 border-t border-bp-line pt-10">
          <h2 className="font-plex-mono text-[11px] uppercase tracking-[0.12em] text-bp-muted">How it works — a three-stage pipeline</h2>
          <div className="mt-6 grid grid-cols-1 divide-y divide-bp-line overflow-hidden rounded-[10px] border border-bp-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {HOW_IT_WORKS.map(({ step, title, detail }) => (
              <div key={step} className="bg-bp-surface p-6">
                <p className="font-plex-mono text-[11px] tracking-wide text-bp-accent">{step}</p>
                <p className="mt-2.5 text-[15px] font-semibold tracking-tight">{title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-bp-muted">{detail}</p>
              </div>
            ))}
          </div>
        </div>

        {/* --- Features ---------------------------------------------------- */}
        <div className="mt-14 border-t border-bp-line pt-10">
          <h2 className="font-plex-mono text-[11px] uppercase tracking-[0.12em] text-bp-muted">What makes this different</h2>
          <div className="mt-6 grid grid-cols-1 border-t border-bp-line sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, label, detail }, i) => (
              <div
                key={label}
                className={`flex gap-3.5 border-b border-bp-line py-5 ${i % 2 === 0 ? "sm:border-r sm:pr-7" : "sm:pl-7"}`}
              >
                <span className="mt-0.5 h-full w-[3px] shrink-0 rounded-full bg-bp-accent-2" />
                <div>
                  <div className="flex items-center gap-2">
                    <Icon size={13} className="text-bp-muted" />
                    <p className="text-[13.5px] font-semibold">{label}</p>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-bp-muted">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 border-t border-bp-line pt-6 pb-4 text-center font-plex-mono text-[10.5px] tracking-wide text-bp-muted">
          BUILT AS A VALIDATED COMMAND PIPELINE — NOT A DIAGRAM GENERATOR
        </div>
      </div>
    </div>
  );
}
