"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import type { Category, Scorecard, Severity } from "@/lib/types";

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
  minor: "bg-slate-100 text-slate-600",
  moderate: "bg-amber-100 text-amber-700",
  major: "bg-red-100 text-red-700",
};

function scoreColor(score: number): string {
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
      setQa((prev) => [
        ...prev,
        { question: q, answer: `⚠️ ${e instanceof Error ? e.message : String(e)}`, citedRuleIds: [] },
      ]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-800">Analyzer</h1>
          {scorecard && (
            <p className={`text-xs font-semibold ${scoreColor(scorecard.overall_score)}`}>
              Overall: {scorecard.overall_score}/100 · rules {scorecard.rules_version}
            </p>
          )}
        </div>
        <button onClick={onExit} className="text-xs text-blue-600 underline">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loadError && <p className="text-xs text-red-600">⚠️ {loadError}</p>}
        {!scorecard && !loadError && <p className="text-xs text-slate-400">Scoring…</p>}

        {scorecard?.categories.map((cat) => (
          <div key={cat.category} className="rounded-md border border-slate-200 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{CATEGORY_LABEL[cat.category]}</span>
              <span className={`text-sm font-bold ${scoreColor(cat.score)}`}>{cat.score}</span>
            </div>
            {cat.findings.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">No findings.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {cat.findings.map((f, i) => (
                  <li key={`${f.rule_id}-${i}`} className="text-xs text-slate-600">
                    <span className={`mr-1 rounded px-1 py-0.5 text-[9px] font-bold ${SEVERITY_STYLE[f.severity]}`}>
                      {f.severity.toUpperCase()}
                    </span>
                    {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {qa.length > 0 && (
          <div className="pt-2 space-y-3 border-t border-slate-100 mt-3">
            {qa.map((entry, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-slate-700">Q: {entry.question}</p>
                <p className="text-xs text-slate-600 mt-0.5">{entry.answer}</p>
                {entry.citedRuleIds.length > 0 && (
                  <p className="mt-1 text-[10px] text-slate-400">cites: {entry.citedRuleIds.join(", ")}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleAsk} className="border-t border-slate-200 p-3 flex gap-2">
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder='e.g. "why is scalability only 62?"'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={asking || !scorecard}
        />
        <button
          type="submit"
          disabled={asking || !question.trim() || !scorecard}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
