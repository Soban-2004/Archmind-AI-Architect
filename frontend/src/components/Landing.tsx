"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  Boxes,
  FolderUp,
  GitCompare,
  Hand,
  Layers,
  Loader2,
  MessageSquare,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  Waves,
  Wrench,
} from "lucide-react";
import { HERO_SCENARIO, HERO_USERS_POSITION, SCENARIOS } from "@/lib/landingScenarios";
import { MiniArchitecturePreview } from "./MiniArchitecturePreview";

interface Props {
  onNewProject: () => void;
  onImportRepo: () => void;
  /** True while page.tsx's handleCreateProject (or switching to an
   * existing project) is actually in flight — a real network round trip
   * (create the project, then load its latest version), not instant.
   * Disables both entry buttons so a slow response (a cold Render
   * instance waking up, in particular) reads as "working on it" instead
   * of inviting a rage-click, and swaps "Start a new project" into a
   * spinner + "Creating…" so there's something to actually look at while
   * it waits. Found live: this prop already existed but was never wired
   * up from the caller, so it always silently did nothing. */
  busy?: boolean;
  /** The project remembered in localStorage, if its data has finished
   * loading silently in the background (see page.tsx's mount effect) —
   * null while there's nothing to resume, or while it's still loading. */
  existingProject?: { id: string; name: string } | null;
  onContinue?: () => void;
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
  { icon: Search, label: "Grounded in live data", detail: "A time-sensitive question — current pricing, whether something's still maintained — triggers a real web search, cited inline, instead of a guess from stale training data." },
  { icon: Hand, label: "Build it by hand, too", detail: "Add, edit, connect, or delete components straight on the canvas — the exact same validated command path a chat edit uses, no separate rules for a human-drawn change." },
  { icon: Wrench, label: "Every node explains itself", detail: "Click a component and see why this project specifically needs it — the actual requirement it serves, not a generic definition of what the component type does." },
];

/**
 * The drafting-sheet frame (corner ticks, bordered plate) around a
 * diagram — used for the scenario rows further down, where several
 * diagrams sitting in a row benefit from reading as contained figures.
 * The hero diagram deliberately does NOT use this: boxed in a bordered
 * card, it read as "one more small screenshot" when its whole job is to
 * look like the actual product at real size, floating over the page. The
 * scenario rows already print their own Fig. number in the text column
 * next to the diagram, so this frame stays unlabeled — just the border
 * and corner ticks, no header to repeat it.
 */
function Figure({ children }: { children: ReactNode }) {
  return (
    <div className="relative rounded-[10px] border border-bp-line-strong bg-bp-surface p-4 before:pointer-events-none before:absolute before:-left-px before:-top-px before:h-2.5 before:w-2.5 before:border-l-[1.5px] before:border-t-[1.5px] before:border-bp-line-strong after:pointer-events-none after:absolute after:-bottom-px after:-right-px after:h-2.5 after:w-2.5 after:border-b-[1.5px] after:border-r-[1.5px] after:border-bp-line-strong">
      <div className="overflow-hidden rounded-md border border-bp-line">{children}</div>
    </div>
  );
}

/**
 * A "blueprint" identity, not the templated purple-gradient SaaS hero —
 * IBM Plex type (engineering-drawing lineage, not the usual Inter/Space
 * Grotesk) and a schematic vocabulary (grid backdrop, annotated plate,
 * drafting-sheet corner ticks) that's actually specific to a system-
 * validation tool. Scoped entirely to this component's own bp-* tokens
 * (globals.css) — the rest of the app keeps its existing brand- and
 * slate-based palette and Geist type untouched.
 *
 * Shown on every visit now, not just a first one — a returning visitor
 * with a project already in progress gets a small, secondary "Continue"
 * link (see existingProject/onContinue) rather than being silently routed
 * around this page entirely; the two big CTAs stay the primary choice.
 * Deliberately no fabricated trust signals (no invented testimonials,
 * user counts, or logos) — every diagram on this page, hero included, is
 * rendered by MiniArchitecturePreview, i.e. the product's own live canvas
 * components fed fixed fixture data, not a stock illustration or a static
 * screenshot.
 */
export function Landing({ onNewProject, onImportRepo, busy, existingProject, onContinue }: Props) {
  return (
    // w-full matters here, not just h-full: the parent in page.tsx is a
    // row flex container (`flex min-h-0 flex-1`), and a flex item with no
    // explicit width shrinks to fit its own content by default — which,
    // since everything inside is capped at max-w-5xl and centered with
    // mx-auto, silently left this whole component sized to that 1024px
    // cap with nothing to center within, showing up as a real empty gap
    // on the right of any viewport wider than that. Found live.
    <div className="relative flex h-full w-full flex-col overflow-y-auto bg-bp-paper font-plex-sans text-bp-ink">
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

      {/* --- Hero --------------------------------------------------------- */}
      {/* Deliberately NOT capped at max-w-5xl like the rest of the page
          below — a 1024px cap left both columns cramped no matter the
          split. Side by side, not stacked — but 60/40 in the diagram's
          favor (minmax(0,2fr) minmax(0,3fr)), not a true 50/50: a
          5-column left-to-right flow needs real width to keep its cards
          legible, and equal weight left them at ~120-150px. Text still
          pins to the left edge via the section's own px-7. */}
      <div className="relative flex w-full flex-col gap-10 px-7 pb-4 pt-14 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-center lg:gap-14">
        {/* pl-[30px]: nudges the text block right of the section's own
            px-7 edge — the header bar above already names the product in
            passing, but this is the first thing said inside the page's
            own content, so it gets a proper wordmark, not just the small
            eyebrow tagline underneath it. */}
        <div className="min-w-0 pl-[30px]">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-bp-accent text-white">
              <Boxes size={15} />
            </div>
            <span className="font-plex-mono text-[15px] font-bold tracking-tight">AI Architect</span>
          </div>

          <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-bp-line-strong px-3 py-1 font-plex-mono text-[11px] uppercase tracking-wide text-bp-accent">
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
            against real structural rules before it ever reaches the diagram — it never just draws a pretty picture
            and hopes.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={onNewProject}
              disabled={busy}
              className="group flex items-center justify-center gap-2 rounded-lg bg-bp-accent px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-bp-accent/25 transition hover:-translate-y-0.5 hover:shadow-xl disabled:pointer-events-none disabled:opacity-75"
            >
              {busy ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <MessageSquare size={15} /> Start a new project
                  <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                </>
              )}
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

          {existingProject && onContinue && (
            <button
              onClick={onContinue}
              className="group mt-4 flex items-center gap-1.5 font-plex-mono text-[11px] tracking-wide text-bp-muted transition hover:text-bp-accent"
            >
              <ArrowRight size={11} className="transition group-hover:translate-x-0.5" />
              Continue &ldquo;{existingProject.name}&rdquo; — right where you left off
            </button>
          )}
        </div>

        {/* No Figure frame here on purpose — a bordered card read as "one
            more small screenshot," when this diagram's whole job is to
            look like the actual product, floating over the page rather
            than boxed away in a corner. No custom maxZoom either (default
            caps at 1, real 1:1 node size — legible cards matter more than
            hitting an exact ratio here). At the 60/40 split above, a
            5-column left-to-right flow lands around 150-190px-wide cards
            on a typical laptop-width window, climbing to the full 200px
            real size on a wide monitor. showBackground={false}: unlike
            the boxed scenario diagrams below, this one already floats
            directly over the page's own blueprint dot-grid backdrop — a
            second, independent React Flow dot pattern layered right
            behind it was just visual noise, not a real canvas floor. */}
        <div className="min-w-0 animate-fade-in">
          <MiniArchitecturePreview
            state={HERO_SCENARIO.state}
            layout={HERO_SCENARIO.layout}
            simulation={HERO_SCENARIO.simulation}
            staggerReveal
            trafficSourcePosition={HERO_USERS_POSITION}
            showBackground={false}
          />
          <p className="mt-3 text-center font-plex-mono text-[10.5px] tracking-wide text-bp-muted">
            Live traffic simulation — every node was proposed as a validated command, never drawn freehand.
          </p>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-7 pb-10">
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
            {FEATURES.map(({ icon: Icon, label, detail }, i) => {
              // An odd-length list (currently 11) leaves one item stranded
              // alone in the last row — instead of a dangling sm:border-r
              // with nothing to its right, that one item spans both
              // columns and drops the right border/padding it would
              // otherwise get from the i%2 pairing below.
              const isStrandedLast = FEATURES.length % 2 === 1 && i === FEATURES.length - 1;
              return (
                <div
                  key={label}
                  className={`flex gap-3.5 border-b border-bp-line py-5 ${
                    isStrandedLast ? "sm:col-span-2" : i % 2 === 0 ? "sm:border-r sm:pr-7" : "sm:pl-7"
                  }`}
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
              );
            })}
          </div>
        </div>

      </div>

      {/* --- Scenarios ---------------------------------------------------- */}
      {/* Broken out of the max-w-5xl wrapper above for the same reason the
          hero was: these diagrams were landing at (or below) the
          MiniArchitecturePreview's own zoom floor inside a half of a
          1024px-capped column — genuinely at or near the minimum legible
          size, not just "a bit small." Full width like the hero gives
          each scenario's own 50/50 split real room to work with. */}
      <div className="relative w-full px-7">
        <div className="border-t border-bp-line pt-10">
          <h2 className="font-plex-mono text-[11px] uppercase tracking-[0.12em] text-bp-muted">See it under real conditions</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-bp-muted">
            The same simulator, the same capacity rules, and the same canvas the product runs on your own project —
            replayed here against fixed traffic so &ldquo;structurally validated&rdquo; has something to point at
            beyond the resting state above.
          </p>
          {/* divide-y (not space-y) so each scenario gets a real boundary
              from its neighbors, not just vertical whitespace that could
              read as one continuous block. */}
          <div className="mt-10 divide-y divide-bp-line">
            {SCENARIOS.map((s, i) => {
              const topFinding = s.simulation.findings[0];
              const textBlock = (
                <div className="min-w-0">
                  <p className="font-plex-mono text-[11px] tracking-wide text-bp-accent">{s.fig}</p>
                  <h3 className="mt-2 text-[19px] font-semibold tracking-tight text-balance">{s.title}</h3>
                  <p className="mt-2.5 text-[13.5px] leading-relaxed text-bp-muted">{s.description}</p>
                  <div className="mt-4 space-y-1.5 border-t border-dashed border-bp-line pt-3.5 font-plex-mono text-[10.5px] tracking-wide text-bp-muted">
                    <p>
                      SCENARIO: {s.simulation.scenario} · MULTIPLIER: ×{s.simulation.multiplier}
                    </p>
                    {topFinding && <p className="text-bp-accent-2">→ {topFinding.message}</p>}
                  </div>
                </div>
              );
              const diagramBlock = (
                <div className="min-w-0">
                  <Figure>
                    <MiniArchitecturePreview state={s.state} layout={s.layout} simulation={s.simulation} />
                  </Figure>
                </div>
              );
              return (
                <div key={s.id} className="grid grid-cols-1 items-center gap-10 py-12 first:pt-0 last:pb-0 lg:grid-cols-2">
                  {i % 2 === 0 ? (
                    <>
                      {textBlock}
                      {diagramBlock}
                    </>
                  ) : (
                    <>
                      {diagramBlock}
                      {textBlock}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mx-auto mt-14 w-full max-w-5xl border-t border-bp-line pt-6 pb-4 text-center font-plex-mono text-[10.5px] tracking-wide text-bp-muted">
          BUILT AS A VALIDATED COMMAND PIPELINE — NOT A DIAGRAM GENERATOR
        </div>
      </div>
    </div>
  );
}
