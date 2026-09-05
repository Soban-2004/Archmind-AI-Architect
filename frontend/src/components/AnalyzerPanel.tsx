"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, SendHorizontal, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Category, Scorecard, Severity } from "@/lib/types";
import { IconButton, ScoreRing, Spinner } from "./ui";

interface Props {
  projectId: string;
  versionId: string;
  onExit: () => void;
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
  minor: "bg-slate-100 text-slate-500",
  moderate: "bg-amber-100 text-amber-700",
  major: "bg-red-100 text-red-700",
};

function scoreTextColor(score: number): string {
  if (score >= 85) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

export function AnalyzerPanel({ projectId, versionId, onExit }: Props) {
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
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
        <div className="flex items-center gap-3">
          {scorecard && <ScoreRing score={scorecard.overall_score} size={42} />}
          <div>
            <h1 className="text-sm font-semibold text-slate-800">Analyzer</h1>
            {scorecard && <p className="text-[11px] text-slate-400">rules {scorecard.rules_version}</p>}
          </div>
        </div>
        <IconButton onClick={onExit}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loadError && <p className="text-xs text-red-600">⚠️ {loadError}</p>}
        {!scorecard && !loadError && (
          <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
            <Spinner className="h-4 w-4" /> Scoring…
          </div>
        )}

        <div className="space-y-2">
          {scorecard?.categories.map((cat) => (
            <div key={cat.category} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-slate-700">{CATEGORY_LABEL[cat.category]}</span>
                <span className={`text-sm font-bold ${scoreTextColor(cat.score)}`}>{cat.score}</span>
              </div>
              {cat.findings.length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {cat.findings.map((f, i) => (
                    <li key={`${f.rule_id}-${i}`} className="flex gap-1.5 text-[11px] leading-snug text-slate-600">
                      <span className={`mt-0.5 h-fit shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${SEVERITY_STYLE[f.severity]}`}>
                        {f.severity}
                      </span>
                      {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {qa.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
            {qa.map((entry, i) => (
              <div key={i} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium text-slate-700">{entry.question}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{entry.answer}</p>
                {entry.citedRuleIds.length > 0 && (
                  <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
                    <AlertTriangle size={10} /> {entry.citedRuleIds.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleAsk} className="flex gap-2 border-t border-slate-200 bg-white p-3">
        <input
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
          placeholder='"why is scalability only 62?"'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={asking || !scorecard}
        />
        <button
          type="submit"
          disabled={asking || !question.trim() || !scorecard}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
        >
          <SendHorizontal size={14} />
        </button>
      </form>
    </div>
  );
}
