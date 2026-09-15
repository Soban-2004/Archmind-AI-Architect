"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import { AlertTriangle, Archive, Check, Download, FileImage, FileText, Link2 } from "lucide-react";
import { api } from "@/lib/api";
import { exportDiagramAsPdf, exportDiagramAsPng, slugify } from "@/lib/exportDiagram";
import { getTheme } from "@/lib/theme";
import { IconButton, Spinner } from "./ui";

interface Props {
  flowElementRef: RefObject<HTMLDivElement | null>;
  projectName: string;
  /** Omitted on the read-only shared view — nothing to build a share link
   * to from there (it already IS the shared view). */
  onShare?: () => void;
  /** Present exactly when there's a real project+version to export a
   * starter kit from (omitted on the read-only shared view and the
   * compare view, same as onShare) — enables "Download starter kit". */
  projectId?: string;
  versionId?: string;
}

type Busy = "png" | "pdf" | "starter-kit" | null;

/**
 * Must render as a child of ReactFlowProvider (ArchitectureCanvas wraps
 * its whole return in one for exactly this) — useReactFlow()'s getNodes()
 * is what returns each node with its real MEASURED width/height, filled
 * in by React Flow after render. The plain `nodes` array ArchitectureCanvas
 * already builds from layout data has positions but not measured
 * dimensions, so getNodesBounds() on that alone would size the export
 * wrong (or zero) for any custom node whose real rendered size isn't the
 * same as its layout placeholder.
 */
export function ExportMenu({ flowElementRef, projectName, onShare, projectId, versionId }: Props) {
  const { getNodes } = useReactFlow();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function handleExport(kind: "png" | "pdf") {
    const flowElement = flowElementRef.current;
    if (!flowElement) return;
    setBusy(kind);
    setError(null);
    try {
      const dark = getTheme() === "dark";
      if (kind === "png") await exportDiagramAsPng(getNodes(), flowElement, projectName, dark);
      else await exportDiagramAsPdf(getNodes(), flowElement, projectName, dark);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Downloads the real zip (ARCHITECTURE.md, AI_BRIEF.md,
   * docker-compose.yml, .env.example — see backend's
   * services/starter_kit.py) via a blob URL + a throwaway <a download>,
   * same client-side-download shape exportDiagram's PNG/PDF use, just
   * fed by a real fetch response instead of a canvas capture. */
  async function handleDownloadStarterKit() {
    if (!projectId || !versionId) return;
    setBusy("starter-kit");
    setError(null);
    try {
      const blob = await api.downloadStarterKit(projectId, versionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(projectName)}-starter-kit.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function handleShare() {
    onShare?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        onClick={() => setOpen((v) => !v)}
        className="border border-slate-200 bg-surface/90 shadow-soft backdrop-blur-sm dark:border-slate-700 dark:bg-surface/90"
        title="Export or share"
      >
        <Download size={14} className={open ? "text-brand-600 dark:text-brand-400" : ""} />
      </IconButton>

      {open && (
        <div className="animate-fade-in absolute right-0 top-full z-30 mt-1.5 w-56 overflow-hidden rounded-xl bg-surface shadow-raised">
          <button
            onClick={() => handleExport("png")}
            disabled={busy !== null}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {busy === "png" ? <Spinner className="h-3.5 w-3.5" /> : <FileImage size={14} className="text-slate-400 dark:text-slate-500" />}
            Download PNG
          </button>
          <button
            onClick={() => handleExport("pdf")}
            disabled={busy !== null}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {busy === "pdf" ? <Spinner className="h-3.5 w-3.5" /> : <FileText size={14} className="text-slate-400 dark:text-slate-500" />}
            Download PDF
          </button>
          {projectId && versionId && (
            <>
              <div className="h-px bg-slate-100 dark:bg-slate-800" />
              <button
                onClick={handleDownloadStarterKit}
                disabled={busy !== null}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
                title="ARCHITECTURE.md, AI_BRIEF.md, docker-compose.yml, .env.example — a real starting point for building this"
              >
                {busy === "starter-kit" ? <Spinner className="h-3.5 w-3.5" /> : <Archive size={14} className="text-slate-400 dark:text-slate-500" />}
                Download starter kit (.zip)
              </button>
            </>
          )}
          {onShare && (
            <>
              <div className="h-px bg-slate-100 dark:bg-slate-800" />
              <button
                onClick={handleShare}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {copied ? <Check size={14} className="text-green-500" /> : <Link2 size={14} className="text-slate-400 dark:text-slate-500" />}
                {copied ? "Link copied" : "Copy read-only link"}
              </button>
            </>
          )}
          {error && (
            <p className="flex items-start gap-1.5 border-t border-slate-100 px-3 py-2 text-[11px] leading-snug text-red-600 dark:border-slate-800 dark:text-red-400">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
