"use client";

import { useState } from "react";
import { ArrowRight, Boxes, Check, FolderUp, GitCompare, Loader2, MessageSquare, ShieldCheck, Waves } from "lucide-react";
import { HERO_SCENARIO, HERO_USERS_POSITION, SCENARIOS } from "@/lib/landingScenarios";
import { BrandMark } from "./BrandMark";
import { MiniArchitecturePreview } from "./MiniArchitecturePreview";

interface Props {
  onNewProject: () => void;
  onImportRepo: () => void;
  busy?: boolean;
  existingProject?: { id: string; name: string } | null;
  onContinue?: () => void;
}

const DEMOS = [
  { label: "Steady traffic", scenario: HERO_SCENARIO },
  { label: "Traffic surge", scenario: SCENARIOS[0] },
  { label: "Failure test", scenario: SCENARIOS[2] },
];
const CAPABILITIES = [
  { icon: ShieldCheck, title: "Every change, checked.", text: "The AI proposes commands. Structural rules validate them before they become part of your architecture." },
  { icon: GitCompare, title: "A history of better decisions.", text: "Compare versions, explore a different tier, or branch from an earlier design. Your decisions stay traceable." },
  { icon: Waves, title: "Put your design under pressure.", text: "Simulate traffic and dependency failures. See which component reaches its limits and why." },
];

export function Landing({ onNewProject, onImportRepo, busy, existingProject, onContinue }: Props) {
  const [demoIndex, setDemoIndex] = useState(0);
  const demo = DEMOS[demoIndex];
  return (
    <div className="w-full overflow-y-auto bg-bp-paper text-bp-ink">
      <main className="mx-auto max-w-[1440px] px-5 py-10 sm:px-10 sm:py-14 lg:px-16">
        <section className="landing-masthead" aria-labelledby="studio-title">
          <div className="grid items-end gap-7 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
            <h1 id="studio-title" className="font-display max-w-3xl text-[clamp(2.7rem,5.8vw,5.5rem)] font-semibold leading-[.96] tracking-[-0.045em] text-balance">Systems that<br />endure<span className="identity-period">.</span></h1>
            <div className="pb-1">
              <p className="max-w-lg text-base leading-relaxed text-bp-ink sm:text-lg">Turn a product idea or codebase into a validated architecture you can inspect, refine, and pressure-test.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={onNewProject} disabled={busy} className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition duration-200 hover:bg-brand-700 active:scale-[.98] disabled:pointer-events-none disabled:opacity-60">
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <MessageSquare size={17} />}{busy ? "Creating project…" : "Start designing"}{!busy && <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />}
                </button>
                <button onClick={onImportRepo} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-bp-line-strong bg-bp-surface px-5 text-sm font-semibold transition duration-200 hover:border-brand-400 hover:bg-bp-accent-soft disabled:pointer-events-none disabled:opacity-60"><FolderUp size={17} /> Import a repository</button>
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs text-bp-muted"><Check size={14} className="text-bp-good" /> No account required · saved for this browser</p>
              {existingProject && onContinue && <button onClick={onContinue} className="mt-3 inline-flex max-w-full items-center gap-2 text-sm text-brand-600 hover:underline dark:text-brand-300"><ArrowRight size={14} /><span className="truncate">Continue {existingProject.name}</span></button>}
            </div>
          </div>
          <div data-ui className="studio-demo mt-9 sm:mt-12">
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 bg-bp-surface px-4 py-3 sm:px-6">
              <div className="flex items-center gap-2.5 text-sm font-medium"><Boxes size={17} className="text-brand-500 dark:text-brand-400" /> Architecture in motion <span className="hidden text-xs font-normal text-bp-muted sm:inline">/ interactive example</span></div>
              <div className="flex flex-wrap gap-1" aria-label="Example simulation">{DEMOS.map(({ label }, index) => <button key={label} onClick={() => setDemoIndex(index)} aria-pressed={demoIndex === index} className={`min-h-9 rounded-md px-3 text-xs font-medium transition-colors ${demoIndex === index ? "bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-300" : "text-bp-muted hover:bg-surface-2"}`}>{label}</button>)}</div>
            </div>
            <div key={demoIndex} className="relative overflow-x-auto px-2 py-8 sm:px-8 sm:py-12"><div className="min-w-[1100px] lg:min-w-0"><MiniArchitecturePreview state={demo.scenario.state} layout={demo.scenario.layout} simulation={demo.scenario.simulation} staggerReveal trafficSourcePosition={demoIndex === 0 ? HERO_USERS_POSITION : undefined} showBackground={false} /></div></div>
            <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-bp-line bg-bp-surface px-4 py-3 sm:px-6"><p aria-live="polite" className="text-xs text-bp-muted">{demoIndex === 0 ? "A validated request path, from users to storage." : demo.scenario.simulation.findings[0]?.message ?? demo.scenario.title}</p>{/* taste-skill-ignore mono: simulation values are technical measurements */}<span className="font-mono text-[11px] text-bp-muted">Illustrative simulation · {demo.scenario.simulation.multiplier}× traffic</span></div>
          </div>
          <p className="mt-3 text-xs text-bp-muted sm:hidden">Swipe the diagram to follow the request path.</p>
        </section>
        <section className="identity-band mt-14 grid gap-8 rounded-[18px_18px_18px_5px] px-6 py-9 sm:mt-20 sm:px-9 lg:grid-cols-3 lg:gap-12" aria-label="Architecture capabilities">{CAPABILITIES.map(({ icon: Icon, title, text }) => <div key={title}><Icon size={23} strokeWidth={1.6} className="text-brand-300" /><h2 className="font-display mt-4 text-xl font-semibold tracking-tight text-white">{title}</h2><p className="mt-2 max-w-md text-base leading-relaxed text-white/75">{text}</p></div>)}</section>
        <section className="mt-14 pt-4 sm:mt-20" aria-labelledby="scenarios-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><h2 id="scenarios-title" className="font-display max-w-lg text-3xl font-semibold tracking-tight sm:text-4xl">From diagram<br />to decision.</h2><p className="max-w-sm text-base leading-relaxed text-bp-ink">These examples use the same canvas and capacity model as your projects, with fixed illustrative traffic.</p></div>
          <div className="mt-10 space-y-8">{SCENARIOS.map((scenario) => <article key={scenario.id} className="grid items-center gap-6 py-5 lg:grid-cols-[.7fr_1.3fr] lg:gap-12"><div><h3 className="font-display text-xl font-semibold">{scenario.title}</h3><p className="mt-3 max-w-md text-base leading-relaxed text-bp-ink">{scenario.description}</p>{/* taste-skill-ignore mono: traffic multiplier and scenario are technical measurements */}<p className="mt-4 font-mono text-xs text-bp-muted">{scenario.simulation.multiplier}× traffic · {scenario.simulation.scenario.replaceAll("_", " ")}</p></div><div data-ui className="studio-demo overflow-x-auto p-3 sm:p-6"><div className="min-w-[1000px] sm:min-w-0"><MiniArchitecturePreview state={scenario.state} layout={scenario.layout} simulation={scenario.simulation} showBackground={false} /></div></div></article>)}</div>
        </section>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 pb-2 text-xs text-bp-muted"><span className="inline-flex items-center gap-2"><BrandMark size={24} /> <span className="font-display font-semibold text-bp-ink">ArchMind</span></span><span>Describe. Validate. Stress-test.</span></footer>
      </main>
    </div>
  );
}
