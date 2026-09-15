"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, DollarSign, SendHorizontal, Wrench, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Category, Finding, Scorecard, Severity } from "@/lib/types";
import { ChatMarkdown, IconButton, ProgressBar, ScoreRing, Spinner } from "./ui";

interface Props {
  projectId: string;
  versionId: string;
  onExit: () => void;
  /** Hands a specific finding to the chat's architect agent and switches to
   * it — same handoff SimulationPanel's "Ask the architect to fix this"
   * already uses (see page.tsx's handleFixInChat): the agent proposes
   * real MutationCommands through the same validated pipeline any chat
   * edit goes through, it doesn't just narrate advice. Closes the loop
   * between "here's what's wrong" and "here's the fix applied", one click. */
  onFixInChat: (message: string) => void;
}

/** Built from the real, already-computed Finding — never hand-authored per
 * click — so the architect agent reasons from the same deterministic fact
 * the scorecard itself is showing, not a paraphrase of it. */
function buildFixRequest(f: Finding): string {
  return `Fix this ${f.severity} ${f.category} finding: "${f.message}" (rule ${f.rule_id}). Propose the specific architecture change(s) needed to resolve it, within the project's existing constraints.`;
}

interface QAEntry {
  question: string;
  answer: string;
  citedRuleIds: string[];
}

const CATEGORY_LABEL: Record<Category, string> = {
  scalability: "Scalability",
  reliability: "Reliability",
  security: "Security",
  cost: "Cost",
  observability: "Observability",
  performance: "Performance",
  maintainability: "Maintainability",
};

const SEVERITY_STYLE: Record<Severity, string> = {
  minor: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300",
  moderate: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  major: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};

function scoreTextColor(score: number): string {
  if (score >= 85) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function scoreBarColor(score: number): string {
  if (score >= 85) return "bg-green-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

export function AnalyzerPanel({ projectId, versionId, onExit, onFixInChat }: Props) {
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qa, setQa] = useState<QAEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScorecard(null);
    setQa([]);
    api
      .getScorecard(projectId, versionId)
      .then((sc) => {
        if (!cancelled) setScorecard(sc);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, versionId]);

  async function handleAsk(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || asking) return;
    const q = question;
    setQuestion("");
    setAsking(true);
    try {
      const { answer } = await api.askScorecard(projectId, versionId, q);
      setQa((prev) => [...prev, { question: q, answer: answer.answer, citedRuleIds: answer.cited_rule_ids }]);
    } catch (e) {
      setQa((prev) => [...prev, { question: q, answer: `⚠️ ${e instanceof Error ? e.message : String(e)}`, citedRuleIds: [] }]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5 dark:border-slate-800">
        <div className="flex items-center gap-3">
          {scorecard && <ScoreRing score={scorecard.overall_score} size={42} />}
          <div>
            <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Analyzer</h1>
            {scorecard && <p className="text-[11px] text-slate-400 dark:text-slate-500">rules {scorecard.rules_version}</p>}
          </div>
        </div>
        <IconButton onClick={onExit}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loadError && <p className="text-xs text-red-600 dark:text-red-400">⚠️ {loadError}</p>}
        {!scorecard && !loadError && (
          <div className="flex items-center gap-2 py-6 text-xs text-slate-400 dark:text-slate-500">
            <Spinner className="h-4 w-4" /> Scoring…
          </div>
        )}

        {scorecard && scorecard.estimated_monthly_cost_usd !== null && (
          <div className="mb-2 rounded-xl bg-surface px-3.5 py-3 shadow-soft dark:bg-slate-800/50">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-200">
                <DollarSign size={13} /> Estimated cost
              </span>
              <span
                className={`text-sm font-bold ${
                  scorecard.budget_monthly_usd !== null && scorecard.estimated_monthly_cost_usd > scorecard.budget_monthly_usd
                    ? "text-red-600 dark:text-red-400"
                    : "text-slate-700 dark:text-slate-200"
                }`}
              >
                ${scorecard.estimated_monthly_cost_usd.toFixed(0)}/mo
              </span>
            </div>
            {scorecard.budget_monthly_usd !== null && (
              <>
                <div className="mt-1.5">
                  <ProgressBar
                    pct={(scorecard.estimated_monthly_cost_usd / scorecard.budget_monthly_usd) * 100}
                    colorClassName={scorecard.estimated_monthly_cost_usd > scorecard.budget_monthly_usd ? "bg-red-500" : "bg-green-500"}
                  />
                </div>
                <p className="mt-1 text-[10.5px] text-slate-400 dark:text-slate-500">budget: ${scorecard.budget_monthly_usd.toFixed(0)}/mo</p>
              </>
            )}
            {scorecard.cost_breakdown.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[10.5px] text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
                  breakdown by component
                </summary>
                <ul className="mt-1.5 space-y-1.5">
                  {scorecard.cost_breakdown.map((item) => (
                    <li key={item.node_id}>
                      <div className="flex justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="truncate">{item.node_name}</span>
                        <span className="shrink-0">${item.monthly_cost_usd.toFixed(0)}/mo</span>
                      </div>
                      {/* The real "why" behind this number — instance size,
                          how many instances the load needs, declared
                          storage — was always computed (capacity.py/cost.py
                          build a real basis string per line) but never
                          actually shown here before; only the disclaimer
                          below pointed at the README instead. */}
                      <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">{item.basis}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] italic text-slate-400 dark:text-slate-500">
                  Rough, declared per-component estimates — not a real quote.
                </p>
              </details>
            )}
          </div>
        )}

        <div className="space-y-2">
          {scorecard?.categories.map((cat) => (
            <div
              key={cat.category}
              className="rounded-xl bg-surface px-3.5 py-2.5 shadow-soft transition-shadow hover:shadow-raised dark:bg-slate-800/50"
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{CATEGORY_LABEL[cat.category]}</span>
                <span className={`text-sm font-bold ${scoreTextColor(cat.score)}`}>{cat.score}</span>
              </div>
              <div className="mt-1.5">
                <ProgressBar pct={cat.score} colorClassName={scoreBarColor(cat.score)} />
              </div>
              {cat.findings.length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {cat.findings.map((f, i) => (
                    <li key={`${f.rule_id}-${i}`} className="group flex items-start gap-1.5 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
                      <span className={`mt-0.5 h-fit shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${SEVERITY_STYLE[f.severity]}`}>
                        {f.severity}
                      </span>
                      <span className="flex-1">{f.message}</span>
                      <IconButton
                        onClick={() => onFixInChat(buildFixRequest(f))}
                        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
                        title="Ask the architect to fix this"
                      >
                        <Wrench size={11} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {qa.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            {qa.map((entry, i) => (
              <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{entry.question}</p>
                <div className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  <ChatMarkdown text={entry.answer} />
                </div>
                {entry.citedRuleIds.length > 0 && (
                  <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                    <AlertTriangle size={10} /> {entry.citedRuleIds.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleAsk} className="flex gap-2 border-t border-slate-200 bg-surface p-3 dark:border-slate-800">
        <input
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-800 dark:focus:ring-brand-500/20"
          placeholder='"why is scalability only 62?"'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={asking || !scorecard}
        />
        <button
          type="submit"
          disabled={asking || !question.trim() || !scorecard}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition duration-150 hover:bg-brand-700 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
        >
          <SendHorizontal size={14} />
        </button>
      </form>
    </div>
  );
}
