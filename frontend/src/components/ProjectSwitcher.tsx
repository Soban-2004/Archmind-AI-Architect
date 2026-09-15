"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ProjectSummary } from "@/lib/api";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { IconButton, Spinner } from "./ui";

interface Props {
  projectId: string | null;
  projectName: string;
  onSwitch: (projectId: string) => void;
  onCreate: () => void;
  /** The project id page.tsx's handleSwitchProject is currently loading
   * (its real network round trip — fetch the project, then its latest
   * version), or null when nothing's in flight. Shows a spinner on that
   * one row and disables every row in the list meanwhile, so a slow
   * response (a cold Render instance waking up, in particular) reads as
   * "working on it" instead of an unresponsive dropdown inviting a
   * rage-click on a different row. */
  switchingToId?: string | null;
}

/**
 * The one piece of project management the app previously had none of at
 * all: every project lived only as a single id remembered in
 * localStorage, with no way to see or return to any other one from the
 * UI. A dropdown from the header button, not a full page — this app is
 * built around one active project at a time, so switching should feel
 * like a quick jump, not a navigation.
 */
export function ProjectSwitcher({ projectId, projectName, onSwitch, onCreate, switchingToId }: Props) {
  const [open, setOpen] = useState(false);
  // null = never fetched yet (first open shows a spinner); every
  // subsequent open re-fetches in the background and swaps in fresh data
  // without a loading flash, so no separate `loading` boolean is needed.
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        if (!cancelled) setProjects((prev) => prev ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRenamingId(null);
        setConfirmDeleteId(null);
      }
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function commitRename(id: string) {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      await api.renameProject(id, name);
      setProjects((prev) => prev && prev.map((p) => (p.id === id ? { ...p, name } : p)));
    } catch {
      // best-effort — the list will self-correct next time it's opened
    }
  }

  async function handleDelete(id: string) {
    setConfirmDeleteId(null);
    try {
      await api.deleteProject(id);
      setProjects((prev) => prev && prev.filter((p) => p.id !== id));
      if (id === projectId) onCreate(); // deleted the active project — fall back to a fresh one
    } catch {
      // ignore — row just won't disappear until reopened
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 active:scale-[0.98] dark:hover:bg-slate-800"
      >
        <div className="leading-tight">
          <p className="font-display max-w-[160px] truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{projectName}</p>
        </div>
        <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="animate-fade-in absolute left-0 top-full z-30 mt-1.5 w-72 overflow-hidden rounded-xl bg-surface shadow-raised">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Projects</p>
            <button
              onClick={() => {
                setOpen(false);
                onCreate();
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand-600 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 active:scale-95 dark:text-brand-300 dark:hover:bg-brand-500/10"
            >
              <Plus size={12} /> New
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {projects === null && (
              <div className="flex items-center justify-center py-6 text-slate-400">
                <Spinner className="h-4 w-4" />
              </div>
            )}
            {projects !== null && projects.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-400 dark:text-slate-500">No projects yet.</p>
            )}
            {projects?.map((p) => (
                <div
                  key={p.id}
                  className={`group flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    p.id === projectId ? "bg-brand-50/60 dark:bg-brand-500/10" : ""
                  }`}
                >
                  {switchingToId === p.id ? (
                    <Spinner className="h-3.5 w-3.5 shrink-0 text-brand-500 dark:text-brand-400" />
                  ) : (
                    <Boxes size={14} className="shrink-0 text-slate-300 dark:text-slate-600" />
                  )}
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(p.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => commitRename(p.id)}
                      className="min-w-0 flex-1 rounded border border-brand-300 bg-white px-1.5 py-0.5 text-sm dark:border-brand-500/50 dark:bg-slate-800"
                    />
                  ) : (
                    <button
                      onClick={() => onSwitch(p.id)}
                      disabled={!!switchingToId}
                      className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-default disabled:opacity-60"
                    >
                      <p className="truncate font-medium text-slate-700 dark:text-slate-200">{p.name}</p>
                      <p className="truncate text-[10.5px] text-slate-400 dark:text-slate-500">
                        {switchingToId === p.id
                          ? "Opening…"
                          : p.node_count !== null
                            ? `${p.node_count} components · `
                            : ""}
                        {switchingToId === p.id ? "" : p.last_activity_at ? relativeTime(p.last_activity_at) : "no activity yet"}
                      </p>
                    </button>
                  )}
                  {p.id === projectId && renamingId !== p.id && <Check size={13} className="shrink-0 text-brand-600 dark:text-brand-400" />}

                  {confirmDeleteId === p.id ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <IconButton onClick={() => handleDelete(p.id)} className="h-6 w-6 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title="Confirm delete">
                        <Check size={12} />
                      </IconButton>
                      <IconButton onClick={() => setConfirmDeleteId(null)} className="h-6 w-6" title="Cancel">
                        <X size={12} />
                      </IconButton>
                    </div>
                  ) : (
                    renamingId !== p.id && (
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <IconButton
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameDraft(p.name);
                          }}
                          className="h-6 w-6"
                          title="Rename"
                        >
                          <Pencil size={11} />
                        </IconButton>
                        <IconButton onClick={() => setConfirmDeleteId(p.id)} className="h-6 w-6 hover:text-red-500" title="Delete">
                          <Trash2 size={11} />
                        </IconButton>
                      </div>
                    )
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
