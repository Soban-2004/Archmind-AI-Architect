"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { listComponentTypes } from "@/lib/componentInfo";
import type { NodeKind } from "@/lib/types";
import { KIND_STYLE } from "./ArchNodeCard";
import { IconButton } from "./ui";

const KIND_ORDER: NodeKind[] = ["service", "database", "queue", "external_dependency", "infra_node"];

// Tags a tile's native drag-and-drop payload so ArchitectureCanvas's
// onDrop only ever reacts to one of OUR tiles, never something dragged in
// from outside the browser tab — exported so both sides read the exact
// same literal instead of two copies that could quietly drift apart.
export const PALETTE_DRAG_MIME = "application/x-ai-architect-node";

export interface PaletteSelection {
  kind: NodeKind;
  type: string;
}

interface TilesProps {
  activeKind: NodeKind;
  onKindChange: (kind: NodeKind) => void;
  /** Fires on either a click OR a drag-drop of a tile — the caller (a
   * plain click has no position; ArchitectureCanvas's onDrop/onPaneContextMenu
   * supply one from a real screenToFlowPosition conversion) decides what
   * "pick" actually means for wherever this picker is being shown. */
  onPick: (selection: PaletteSelection) => void;
}

/** The shared tab strip + tile grid: one row of kind tabs (reusing
 * ArchNodeCard's own KIND_STYLE icons/colors, so a tile is a real preview
 * of the node it becomes, not a second visual language), and a scrollable
 * list of that kind's types below, each with a plain-language description
 * from componentInfo.ts instead of a raw enum value. Rendered from TWO
 * places — the toolbar "+" popover (ComponentPalette below) and the
 * right-click "Add component here" context menu (ArchitectureCanvas) — so
 * both entry points are always literally the same picker, never two that
 * could quietly drift apart.
 *
 * Every tile is draggable (onDragStart tags the browser's own native
 * drag-and-drop with a small JSON payload ArchitectureCanvas's onDrop
 * reads back) AND clickable (onPick fires immediately, no drag needed) —
 * dragging places a node exactly where you drop it; clicking is the
 * equally-valid, non-spatial fallback (and the only option where there's
 * no canvas to drop onto yet — an empty project). */
export function PaletteTiles({ activeKind, onKindChange, onPick }: TilesProps) {
  const types = listComponentTypes(activeKind);
  const activeStyle = KIND_STYLE[activeKind];
  const ActiveIcon = activeStyle.Icon;

  return (
    <div className="flex w-72 flex-col">
      <div className="flex gap-0.5 border-b border-slate-200 px-1.5 pt-1.5 dark:border-slate-800">
        {KIND_ORDER.map((kind) => {
          const style = KIND_STYLE[kind];
          const KindIcon = style.Icon;
          const active = kind === activeKind;
          return (
            <button
              key={kind}
              onClick={() => onKindChange(kind)}
              title={style.label}
              className={`flex flex-1 flex-col items-center gap-1 rounded-t-lg px-1 py-1.5 text-[10px] font-medium transition-colors ${
                active ? `${style.bg} ${style.icon}` : "text-slate-400 hover:bg-slate-50 dark:text-slate-500 dark:hover:bg-slate-800"
              }`}
            >
              <KindIcon size={14} />
              {style.label}
            </button>
          );
        })}
      </div>
      <div className="flex max-h-80 flex-col gap-1 overflow-y-auto p-2">
        {types.map(({ type, info }) => (
          <div
            key={type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(PALETTE_DRAG_MIME, JSON.stringify({ kind: activeKind, type }));
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onPick({ kind: activeKind, type })}
            title="Click to add, or drag onto the canvas"
            className="group flex cursor-grab items-start gap-2 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-slate-200 hover:bg-slate-50 active:cursor-grabbing dark:hover:border-slate-700 dark:hover:bg-slate-800"
          >
            <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${activeStyle.bg} ${activeStyle.icon}`}>
              <ActiveIcon size={12} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{info.label}</p>
              <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-slate-400 dark:text-slate-500">{info.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props {
  onPick: (selection: PaletteSelection) => void;
  disabled?: boolean;
}

/** The toolbar entry point — a "+" button opening PaletteTiles in a
 * popover. Replaces the old form-based AddNodeMenu (kind/type dropdowns,
 * a bare name/engine/rationale form): this component only ever reports
 * "the user picked kind X, type Y" — building the actual AddNodeCommand
 * (sensible default name/engine, and where it lands) is
 * ArchitectureCanvas's job now, since that's what owns screenToFlowPosition
 * and the drag/drop/right-click placement logic this menu shares with. */
export function ComponentPalette({ onPick, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [activeKind, setActiveKind] = useState<NodeKind>("service");
  const rootRef = useRef<HTMLDivElement>(null);

  // Same pattern ProjectSwitcher's dropdown already uses — found live:
  // this popover had no way to close except picking a tile or toggling
  // the "+" button again, so clicking anywhere else on the canvas just
  // left it hanging open.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="border border-slate-200 bg-white/90 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90"
        title="Add a component"
      >
        <Plus size={14} className={open ? "text-brand-600 dark:text-indigo-400" : ""} />
      </IconButton>
      {open && (
        <div className="animate-fade-in absolute right-0 top-full z-30 mt-1.5 rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <PaletteTiles
            activeKind={activeKind}
            onKindChange={setActiveKind}
            onPick={(selection) => {
              onPick(selection);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
