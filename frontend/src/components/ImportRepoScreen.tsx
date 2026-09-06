"use client";

import { useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileArchive, FolderUp, RotateCcw, Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { IngestResponse } from "@/lib/types";
import { Button, Spinner } from "./ui";

interface Props {
  onSuccess: (result: IngestResponse) => void;
  onCancel: () => void;
}

type Status = "form" | "uploading" | "result";

/**
 * Deliberately three distinct result treatments, not one generic error
 * box — the three real failure/success shapes services/ingestion.py can
 * actually produce read very differently to a user and call for
 * different next actions:
 *   - clean or caveated success -> proceed, with the caveats visible
 *   - "nothing here was in scope" (no evidence at all) -> try a
 *     different repo, this one isn't fixable by retrying
 *   - a real technical failure (LLM/network) -> try again, this one is
 */
function classify(result: IngestResponse): "success" | "out_of_scope" | "technical_failure" {
  if (result.ok) return "success";
  if (!result.error && result.unsupported_notes.length > 0) return "out_of_scope";
  if (result.error?.toLowerCase().includes("no evidence")) return "out_of_scope";
  return "technical_failure";
}

export function ImportRepoScreen({ onSuccess, onCancel }: Props) {
  const [status, setStatus] = useState<Status>("form");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setUploadError("Please choose a .zip file.");
      return;
    }
    setUploadError(null);
    setFile(f);
    if (!name) setName(f.name.replace(/\.zip$/i, ""));
  }

  async function handleSubmit() {
    if (!file) return;
    setStatus("uploading");
    setUploadError(null);
    try {
      const r = await api.ingestRepo(file, name.trim() || "Imported Project");
      setResult(r);
      setStatus("result");
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e), unsupported_notes: [] });
      setStatus("result");
    }
  }

  function reset() {
    setStatus("form");
    setFile(null);
    setResult(null);
    setUploadError(null);
  }

  return (
    // w-full matters here too (see the identical fix + explanation in
    // Landing.tsx) — without it this flex item shrinks to its own content
    // width inside page.tsx's row flex container, and justify-center has
    // nothing to center within.
    <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto px-6 py-10">
      <div className="w-full max-w-xl">
        <button
          onClick={onCancel}
          className="mb-6 flex items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
        >
          <ArrowLeft size={12} /> Back
        </button>

        {status === "form" && (
          <div className="animate-fade-in">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Import an existing repo</h1>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Upload a .zip of the project. Supported today: Python and JavaScript/TypeScript source, and Docker
              Compose files — every component is reconstructed from real evidence (imports, routes, compose
              services), never guessed.
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                pickFile(e.dataTransfer.files?.[0] ?? null);
              }}
              onClick={() => inputRef.current?.click()}
              className={`mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
                dragActive
                  ? "border-brand-400 bg-brand-50/60 dark:border-indigo-500/50 dark:bg-indigo-500/5"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <>
                  <FileArchive size={22} className="text-brand-500 dark:text-indigo-400" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{file.name}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{(file.size / 1024).toFixed(0)} KB — click to choose a different file</p>
                </>
              ) : (
                <>
                  <Upload size={22} className="text-slate-300 dark:text-slate-600" />
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Drop a .zip here, or click to browse</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">Up to 25MB</p>
                </>
              )}
            </div>
            {uploadError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">⚠️ {uploadError}</p>}

            <label className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Project name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Imported Project"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            />

            <Button className="mt-5 w-full" disabled={!file} onClick={handleSubmit}>
              <FolderUp size={14} /> Import and reconstruct
            </Button>
          </div>
        )}

        {status === "uploading" && (
          <div className="animate-fade-in flex flex-col items-center py-10 text-center">
            <Spinner className="h-6 w-6 text-brand-500" />
            <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-300">Analyzing your repository…</p>
            <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              Scanning files, extracting real evidence (imports, routes, docker-compose services), then reconstructing
              the architecture from it — never from raw code directly.
            </p>
          </div>
        )}

        {status === "result" && result && <ResultView result={result} onSuccess={onSuccess} onRetry={reset} />}
      </div>
    </div>
  );
}

function ResultView({ result, onSuccess, onRetry }: { result: IngestResponse; onSuccess: (r: IngestResponse) => void; onRetry: () => void }) {
  const kind = classify(result);

  if (kind === "success") {
    const nodeCount = result.version?.state.nodes.length ?? 0;
    const edgeCount = result.version?.state.edges.length ?? 0;
    const evidenceCount = result.evidence?.length ?? 0;
    const hasCaveats = (result.dropped_uncited_refs?.length ?? 0) > 0 || result.unsupported_notes.length > 0;

    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-400">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Reconstructed {nodeCount} component{nodeCount === 1 ? "" : "s"}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {edgeCount} connection{edgeCount === 1 ? "" : "s"} · from {evidenceCount} pieces of real evidence
            </p>
          </div>
        </div>

        {result.summary && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            {result.summary}
          </p>
        )}

        {hasCaveats && (
          <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/10">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-400">
              <AlertTriangle size={12} /> A few things worth knowing
            </p>
            {(result.dropped_uncited_refs?.length ?? 0) > 0 && (
              <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400/90">
                The AI proposed {result.dropped_uncited_refs!.length} component
                {result.dropped_uncited_refs!.length === 1 ? "" : "s"} it couldn&apos;t point at real evidence for —
                excluded automatically rather than shown as if it were confirmed.
              </p>
            )}
            {result.unsupported_notes.map((note, i) => (
              <p key={i} className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400/90">
                {note}
              </p>
            ))}
          </div>
        )}

        <Button className="mt-5 w-full" onClick={() => onSuccess(result)}>
          Open in canvas
        </Button>
      </div>
    );
  }

  if (kind === "out_of_scope") {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <FolderUp size={18} />
          </div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Nothing to reconstruct from this repo yet</p>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          This pipeline currently understands Python, JavaScript/TypeScript, and Docker Compose — it didn&apos;t find
          any of those in what was uploaded, so there was no real evidence to reconstruct an architecture from. That&apos;s
          a scope gap, not something retrying will fix.
        </p>
        {result.unsupported_notes.length > 0 && (
          <div className="mt-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
            {result.unsupported_notes.map((note, i) => (
              <p key={i} className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {note}
              </p>
            ))}
          </div>
        )}
        <Button variant="secondary" className="mt-5 w-full" onClick={onRetry}>
          <RotateCcw size={13} /> Try a different repo
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">
          <AlertTriangle size={18} />
        </div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Reconstruction failed</p>
      </div>
      <p className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700 dark:bg-red-500/10 dark:text-red-400">
        {result.error || "An unknown error occurred."}
      </p>
      <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">This looks transient — the same repo should work on retry.</p>
      <Button className="mt-5 w-full" onClick={onRetry}>
        <RotateCcw size={13} /> Try again
      </Button>
    </div>
  );
}
