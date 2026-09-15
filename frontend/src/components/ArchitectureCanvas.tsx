"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Map, Network, Redo2, Trash2, Undo2, X } from "lucide-react";
import { toFlowElements } from "@/lib/diffView";
import type { LayoutMap } from "@/lib/layout";
import { applySimulation } from "@/lib/simView";
import { listComponentTypes } from "@/lib/componentInfo";
import type { AddNodeCommand, ArchEdge, ArchitectureState, ArchNode, MutationCommand, NodeKind, SimulationResult, VersionDiff, VersionEvidence } from "@/lib/types";
import { ArchNodeCard } from "./ArchNodeCard";
import { CanvasLoadingOverlay } from "./CanvasLoadingOverlay";
import { ComponentPalette, PALETTE_DRAG_MIME, PaletteTiles, type PaletteSelection } from "./ComponentPalette";
import { ExportMenu } from "./ExportMenu";
import { FlowEdge } from "./FlowEdge";
import { NodeDetailCard } from "./NodeDetailCard";
import { SimulationDock, type SimDockProps } from "./SimulationDock";
import { TrafficSourceNode } from "./TrafficSourceNode";
import { EmptyState, IconButton, Spinner } from "./ui";

const nodeTypes: NodeTypes = { archNode: ArchNodeCard, trafficSource: TrafficSourceNode };
const edgeTypes: EdgeTypes = { flow: FlowEdge };

const MINIMAP_KIND_COLOR: Record<string, string> = {
  service: "#3b82f6",
  database: "#10b981",
  queue: "#a855f7",
  external_dependency: "#f97316",
  infra_node: "#64748b",
};

/** What a manually-drawn edge should default to, based on what it's
 * pointing at — a reasonable guess, not a claim of certainty; the
 * connectivity registry (check_edge_validity, server-side) is what
 * actually rejects a structurally bad connection, protocol/sync_async
 * aren't validated the same way, so getting this guess slightly wrong
 * never produces an invalid edge, just a label worth refining later. */
function defaultProtocolFor(target: ArchNode): { protocol: ArchEdge["protocol"]; sync_async: ArchEdge["sync_async"] } {
  if (target.node_kind === "database") return { protocol: target.type === "keyvalue" ? "cache" : "sql", sync_async: "sync" };
  if (target.node_kind === "queue") return { protocol: "queue", sync_async: "async_" };
  return { protocol: "http", sync_async: "sync" };
}

/** Builds the real AddNodeCommand for a palette pick — sensible defaults
 * instead of a blank form: the name comes from componentInfo.ts's human
 * label ("New Relational Database"), and `engine` (required server-side
 * for database/queue — Database.engine/Queue.engine have no default)
 * pre-fills from that type's first real-world example ("PostgreSQL",
 * "Redis Cloud Pricing"-style names all match engines.py's substring
 * lookup case-insensitively, same as anything a user would've typed by
 * hand). Both are meant to be renamed/adjusted immediately — see
 * ArchitectureCanvas's auto-open-in-edit-mode after placing. */
function buildAddNodeCommand(kind: NodeKind, type: string): AddNodeCommand {
  const info = listComponentTypes(kind).find((t) => t.type === type)?.info;
  const attributes: Record<string, unknown> = { type };
  if (kind === "database" || kind === "queue") attributes.engine = info?.examples?.[0] ?? "";
  const name = info ? `New ${info.label}` : `New ${type.replace(/_/g, " ")}`;
  return { op: "add_node", ref: "new_node", node_type: kind, name, attributes };
}

interface Props {
  state: ArchitectureState | null;
  layout: LayoutMap;
  diff?: VersionDiff | null;
  simulation?: SimulationResult | null;
  /** Called once per drag (on release) with just the node(s) that moved,
   * so the caller can persist positions back onto the active version's
   * layout — letting future incremental edits carry a user's manual
   * arrangement forward instead of resetting it. Omit for a read-only
   * canvas (e.g. the compare view). */
  onNodePositionsChange?: (updates: LayoutMap) => void;
  /** True while a chat turn is in flight — surfaces a loading overlay so a
   * long-running request (production-tier redesigns with redundancy,
   * replicas, and observability can genuinely take a minute or two) never
   * reads as the canvas being frozen or broken. */
  busy?: boolean;
  /** Enables direct editing from the NodeDetailCard (click a node -> edit
   * a field -> save, no chat round-trip). Omit for a read-only canvas
   * (the compare view has no single active version to edit onto). */
  onNodeSave?: (nodeId: string, attributes: Record<string, unknown>) => Promise<void>;
  /** Enables manual building/editing — the add-component palette,
   * drag-to-connect, and delete (node or edge) — by sending real
   * MutationCommands through the exact same validated path a chat edit
   * already uses (see page.tsx's handleApplyCommands). Omit alongside
   * onNodeSave for a read-only canvas. */
  onApplyCommands?: (commands: MutationCommand[]) => Promise<void>;
  /** Quick undo/redo for the last edit (chat, manual, or node-detail save)
   * — a client-side jump to the neighboring version, not a separate
   * mutation (see page.tsx's undoStack). Omit either to hide/disable the
   * corresponding button; both omitted alongside onApplyCommands for a
   * fully read-only canvas (e.g. the compare view). */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** The active version's persisted evidence/citations, forwarded
   * straight to NodeDetailCard — see its own prop doc for what this is
   * and why it's usually empty. */
  evidence?: VersionEvidence;
  /** Present exactly when the Simulate tab is active on a live (non-
   * compare) canvas — renders the playback dock and enables click-a-node
   * Kill/Revive from NodeDetailCard. Omit to render a plain canvas with
   * no simulation controls at all. */
  simDock?: SimDockProps;
  /** Name used for the exported file (e.g. "checkout-service-architecture.png").
   * Falls back to a generic name if omitted. */
  projectName?: string;
  /** Present exactly when there's a real project+version to link to (i.e.
   * not already on the read-only shared view itself) — enables "Copy
   * read-only link" in the export menu. */
  onShare?: () => void;
  /** Same "real project+version, not the read-only shared/compare view"
   * gate as onShare — passed straight through to ExportMenu to enable
   * "Download starter kit". */
  projectId?: string;
  versionId?: string;
}

/** Thin wrapper: ReactFlowProvider has to sit OUTSIDE the component that
 * calls useReactFlow() (CanvasBody below needs it for screenToFlowPosition
 * — drag-and-drop and right-click placement both convert a raw screen
 * point to a canvas coordinate), so all the actual state/rendering lives
 * one level down instead of in this function directly. ExportMenu already
 * established this same "sibling instantiated inside the Provider" shape
 * for the same reason. */
export function ArchitectureCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasBody {...props} />
    </ReactFlowProvider>
  );
}

function CanvasBody({
  state,
  layout,
  diff,
  simulation,
  onNodePositionsChange,
  busy = false,
  onNodeSave,
  onApplyCommands,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  simDock,
  projectName,
  onShare,
  projectId,
  versionId,
  evidence,
}: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [deletingEdge, setDeletingEdge] = useState(false);
  const [edgeError, setEdgeError] = useState<string | null>(null); // also used for a rejected manual add_node — see handlePaletteAdd
  const [minimapVisible, setMinimapVisible] = useState(true);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // "Pause" freezes the actual SVG particle animation in place rather than
  // just hiding a boolean — these are native SMIL <animateMotion>
  // elements (see FlowEdge.tsx), and pauseAnimations()/unpauseAnimations()
  // on the SVG root is the real, purpose-built browser API for exactly
  // this, applying to every particle at once without touching edge data.
  // Depends on primitives, not the `simDock` object itself — it's a fresh
  // object literal every render in the caller, which would otherwise
  // re-run this on every render instead of only when playback actually
  // toggles.
  const dockActive = !!simDock;
  const dockPlaying = simDock?.playing ?? false;
  useEffect(() => {
    if (!dockActive) return;
    const svgs = flowWrapperRef.current?.querySelectorAll<SVGSVGElement>("svg");
    svgs?.forEach((svg) => {
      if (dockPlaying) svg.unpauseAnimations?.();
      else svg.pauseAnimations?.();
    });
  }, [dockActive, dockPlaying]);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) for undo/redo — the
  // standard shortcut everywhere else already trains for. Skipped while
  // focus is in a text input/textarea/contenteditable so it doesn't fight
  // a user's actual text-editing undo (e.g. mid-edit in NodeDetailCard's
  // rationale textarea) — undo/redo here targets the CANVAS's history,
  // not whatever field currently has focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" && e.key.toLowerCase() !== "y") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
        if (onRedo && canRedo) {
          e.preventDefault();
          onRedo();
        }
      } else if (e.key.toLowerCase() === "z") {
        if (onUndo && canUndo) {
          e.preventDefault();
          onUndo();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo, onRedo, canUndo, canRedo]);

  // A drag needs to move a node the instant the pointer moves, well before
  // any position update could round-trip up to the parent's `layout` state
  // and back down as a prop. So dragged positions live here as a small
  // overlay on top of the prop-derived layout, applied live by
  // onNodesChange (a real event handler, not an effect) and left in place
  // even after the drag is persisted upward — by then the parent's layout
  // carries the same coordinates anyway, so the overlay is just a no-op.
  // Also where a just-placed palette node's drop position lands (see the
  // pendingDrop effect below) — same overlay, same reasoning.
  const [dragOverrides, setDragOverrides] = useState<LayoutMap>({});

  const { nodes: baseNodes, edges } = useMemo(() => {
    if (!state) return { nodes: [] as Node[], edges: [] as Edge[] };
    const base = toFlowElements(state, layout, diff);
    return simulation ? applySimulation(base.nodes, base.edges, simulation) : base;
  }, [state, layout, diff, simulation]);

  const nodes = useMemo(
    () => baseNodes.map((n) => (dragOverrides[n.id] ? { ...n, position: dragOverrides[n.id] } : n)),
    [baseNodes, dragOverrides]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moved: LayoutMap = {};
      const released: LayoutMap = {};
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          moved[c.id] = c.position;
          // `dragging: false` fires once on release — only persist then,
          // not on every intermediate pointer-move frame of the drag.
          if (c.dragging === false) released[c.id] = c.position;
        }
      }
      if (Object.keys(moved).length > 0) setDragOverrides((prev) => ({ ...prev, ...moved }));
      if (Object.keys(released).length > 0) onNodePositionsChange?.(released);
    },
    [onNodePositionsChange]
  );

  const selectedNode = selectedNodeId ? (state?.nodes.find((n) => n.id === selectedNodeId) ?? null) : null;
  const selectedLoad = selectedNodeId ? simulation?.loads.find((l) => l.node_id === selectedNodeId) : undefined;
  const selectedFinding = selectedNodeId ? simulation?.findings.find((f) => f.node_id === selectedNodeId) : undefined;
  const selectedEdge = selectedEdgeId ? (state?.edges.find((e) => e.id === selectedEdgeId) ?? null) : null;

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!onApplyCommands || !state || !connection.source || !connection.target) return;
      const targetNode = state.nodes.find((n) => n.id === connection.target);
      if (!targetNode) return;
      const { protocol, sync_async } = defaultProtocolFor(targetNode);
      try {
        await onApplyCommands([{ op: "add_edge", from_id: connection.source, to_id: connection.target, protocol, sync_async }]);
      } catch (e) {
        setEdgeError(e instanceof Error ? e.message : String(e));
      }
    },
    [onApplyCommands, state]
  );

  // --- Component palette: add a node from the drag-and-drop/click/right-
  // click picker (ComponentPalette / PaletteTiles) ---------------------
  //
  // Placing a node has two things the plain add_node command can't carry
  // itself (positions are a purely frontend/layout concern — see
  // computeIncrementalLayout — never part of the command server sends):
  // 1. where it should land (the drop point, or the right-click point;
  //    omitted for a plain click, which falls back to whatever the
  //    incremental layout naturally picks, same as today's behavior).
  // 2. that it should immediately open selected, in edit mode, so renaming
  //    it away from "New Relational Database" is one click, not a hunt.
  //
  // Neither is knowable from the command alone — the server only ever
  // returns the new, real node id inside the full updated state, so both
  // are resolved here by diffing node ids just before vs. just after the
  // apply resolves (`pendingAutoEditIdsRef`), rather than guessing at a
  // ref-to-id mapping that isn't reliable across a validated round trip.
  const pendingAutoEditIdsRef = useRef<Set<string> | null>(null);
  const pendingDropPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [autoEditNodeId, setAutoEditNodeId] = useState<string | null>(null);

  const handlePaletteAdd = useCallback(
    async (kind: NodeKind, type: string, flowPosition?: { x: number; y: number }) => {
      if (!onApplyCommands) return;
      pendingAutoEditIdsRef.current = new Set((state?.nodes ?? []).map((n) => n.id));
      pendingDropPositionRef.current = flowPosition ?? null;
      try {
        await onApplyCommands([buildAddNodeCommand(kind, type)]);
      } catch (e) {
        pendingAutoEditIdsRef.current = null;
        pendingDropPositionRef.current = null;
        setEdgeError(e instanceof Error ? e.message : String(e));
      }
    },
    [onApplyCommands, state]
  );

  useEffect(() => {
    const beforeIds = pendingAutoEditIdsRef.current;
    if (!beforeIds || !state) return;
    pendingAutoEditIdsRef.current = null;
    const dropPosition = pendingDropPositionRef.current;
    pendingDropPositionRef.current = null;
    const added = state.nodes.find((n) => !beforeIds.has(n.id));
    if (!added) return;
    setSelectedNodeId(added.id);
    setSelectedEdgeId(null);
    setEdgeError(null);
    setAutoEditNodeId(added.id);
    if (dropPosition) {
      setDragOverrides((prev) => ({ ...prev, [added.id]: dropPosition }));
      onNodePositionsChange?.({ [added.id]: dropPosition });
    }
  }, [state, onNodePositionsChange]);

  function handleDragOverCanvas(e: DragEvent<HTMLDivElement>) {
    if (!onApplyCommands || !e.dataTransfer.types.includes(PALETTE_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDropOnCanvas(e: DragEvent<HTMLDivElement>) {
    if (!onApplyCommands) return;
    const raw = e.dataTransfer.getData(PALETTE_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    let selection: PaletteSelection;
    try {
      selection = JSON.parse(raw);
    } catch {
      return;
    }
    const flowPosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    void handlePaletteAdd(selection.kind, selection.type, flowPosition);
  }

  // --- Right-click "Add component here" ---------------------------------
  const [contextMenu, setContextMenu] = useState<{ localX: number; localY: number; flowX: number; flowY: number } | null>(null);
  const [contextMenuKind, setContextMenuKind] = useState<NodeKind>("service");

  useEffect(() => {
    if (!contextMenu) return;
    function close() {
      setContextMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    // Attached a tick late so the same right-click that opened this menu
    // doesn't immediately bubble into this listener and close it again.
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", close);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  async function handleDeleteNode(nodeId: string) {
    if (!onApplyCommands) return;
    await onApplyCommands([{ op: "remove_node", id: nodeId }]);
    setSelectedNodeId(null);
    setAutoEditNodeId(null);
  }

  async function handleDeleteEdge() {
    if (!onApplyCommands || !selectedEdgeId) return;
    setDeletingEdge(true);
    setEdgeError(null);
    try {
      await onApplyCommands([{ op: "remove_edge", id: selectedEdgeId }]);
      setSelectedEdgeId(null);
    } catch (e) {
      setEdgeError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingEdge(false);
    }
  }

  if (!state || state.nodes.length === 0) {
    if (busy) {
      return (
        <div className="relative h-full w-full">
          <CanvasLoadingOverlay active fullscreen />
        </div>
      );
    }
    return (
      <div className="relative flex h-full flex-col">
        <EmptyState
          icon={<Network size={22} />}
          title="No architecture yet"
          description={onApplyCommands ? "Answer a few questions in the chat, or add the first component yourself." : "Answer a few questions in the chat to generate one."}
        />
        {onApplyCommands && (
          // No canvas is mounted yet, so there's nowhere to drop onto or
          // right-click — a plain click-to-place (no position override,
          // same as today) is the whole interaction here; drag/right-click
          // both become available once there's an actual canvas below.
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <ComponentPalette onPick={(sel) => void handlePaletteAdd(sel.kind, sel.type)} />
          </div>
        )}
      </div>
    );
  }

  return (
    // ExportMenu -- a sibling overlay, not a child of <ReactFlow> itself --
    // calls useReactFlow().getNodes() for the real, measured node
    // dimensions an accurate export needs (the `nodes` array below only
    // has layout positions, not post-render measured sizes); it can do
    // that here because this whole tree already sits inside the
    // ReactFlowProvider the outer ArchitectureCanvas wraps it in.
    <div
      ref={flowWrapperRef}
      className="relative h-full w-full"
      onDragOver={handleDragOverCanvas}
      onDrop={handleDropOnCanvas}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onApplyCommands ? onConnect : undefined}
        nodesConnectable={!!onApplyCommands}
        fitView
        // Compact-to-fit, not flow-bigger: the whole diagram always scales
        // to the available space rather than requiring a scrollbar, so
        // extra chrome (the sim dock) just needs its own reserved margin
        // rather than a layout rethink — leave real room at the bottom
        // when the dock is showing so it never sits over a node.
        fitViewOptions={simDock ? { padding: { top: "40px", left: "40px", right: "40px", bottom: "110px" } } : undefined}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          setSelectedNodeId(node.id);
          setSelectedEdgeId(null);
          setEdgeError(null);
          setContextMenu(null);
          // A real click is always a deliberate re-selection, never the
          // auto-placement path (that sets selection itself, from
          // handlePaletteAdd's effect, never via this handler) — clearing
          // here stops a later click on the same just-placed node from
          // re-opening edit mode on some future remount.
          setAutoEditNodeId(null);
        }}
        onEdgeClick={(_, edge) => {
          if (!onApplyCommands) return;
          setSelectedEdgeId(edge.id);
          setSelectedNodeId(null);
          setEdgeError(null);
          setContextMenu(null);
          setAutoEditNodeId(null);
        }}
        onPaneClick={() => {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setEdgeError(null);
          setContextMenu(null);
          setAutoEditNodeId(null);
        }}
        onPaneContextMenu={(e) => {
          if (!onApplyCommands) return;
          e.preventDefault();
          const rect = flowWrapperRef.current?.getBoundingClientRect();
          const clientX = "clientX" in e ? e.clientX : 0;
          const clientY = "clientY" in e ? e.clientY : 0;
          const flowPosition = screenToFlowPosition({ x: clientX, y: clientY });
          setContextMenuKind("service");
          setContextMenu({
            localX: clientX - (rect?.left ?? 0),
            localY: clientY - (rect?.top ?? 0),
            flowX: flowPosition.x,
            flowY: flowPosition.y,
          });
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--rf-dot-color)" />
        <Controls showInteractive={false} />
        {nodes.length > 5 && minimapVisible && (
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={0}
            bgColor="transparent"
            maskColor="rgba(100,116,139,0.08)"
            nodeColor={(n: Node) => {
              const archNode = (n.data as { archNode?: ArchNode })?.archNode;
              return (archNode && MINIMAP_KIND_COLOR[archNode.node_kind]) || "#94a3b8";
            }}
          />
        )}
      </ReactFlow>
      {nodes.length > 5 && (
        // Top-right: Controls defaults to bottom-left and MiniMap to
        // bottom-right, so this is the one corner nothing else claims.
        <IconButton
          onClick={() => setMinimapVisible((v) => !v)}
          className="absolute right-3.5 top-3.5 z-10 border border-slate-200 bg-surface/90 shadow-soft backdrop-blur-sm dark:border-slate-700 dark:bg-surface/90"
          title={minimapVisible ? "Hide minimap" : "Show minimap"}
        >
          <Map size={14} className={minimapVisible ? "text-brand-600 dark:text-brand-400" : ""} />
        </IconButton>
      )}
      {selectedNode && (
        <NodeDetailCard
          key={selectedNode.id}
          node={selectedNode}
          load={selectedLoad}
          finding={selectedFinding}
          onClose={() => {
            setSelectedNodeId(null);
            setAutoEditNodeId(null);
          }}
          onSave={onNodeSave}
          onDelete={onApplyCommands ? handleDeleteNode : undefined}
          killed={simDock?.killIds.includes(selectedNode.id)}
          onToggleKill={simDock ? () => simDock.onToggleKill(selectedNode.id) : undefined}
          evidence={evidence}
          startInEditMode={selectedNode.id === autoEditNodeId}
        />
      )}
      {selectedEdge && onApplyCommands && (
        // Same top-left slot NodeDetailCard uses — mutually exclusive
        // with it (selecting an edge clears the node selection and vice
        // versa), so there's never a collision.
        <div className="animate-fade-in absolute left-4 top-4 z-10 w-72 rounded-xl bg-surface/95 p-4 shadow-raised backdrop-blur dark:bg-surface/95">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Remove the connection from{" "}
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {state.nodes.find((n) => n.id === selectedEdge.from_id)?.name ?? selectedEdge.from_id}
              </span>{" "}
              to{" "}
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {state.nodes.find((n) => n.id === selectedEdge.to_id)?.name ?? selectedEdge.to_id}
              </span>
              ?
            </p>
            <IconButton onClick={() => setSelectedEdgeId(null)} className="h-6 w-6 shrink-0">
              <X size={13} />
            </IconButton>
          </div>
          {edgeError && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">⚠️ {edgeError}</p>}
          <button
            onClick={handleDeleteEdge}
            disabled={deletingEdge}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {deletingEdge ? <Spinner className="h-3 w-3" /> : <Trash2 size={12} />} Remove connection
          </button>
        </div>
      )}
      {edgeError && !selectedEdge && (
        // A rejected manual action with no dedicated card to live in — a
        // manually-drawn edge the connectivity registry refused (onConnect),
        // or a manual add_node that failed the same validation
        // (handlePaletteAdd) — a small dismissible banner either way.
        <div className="animate-fade-in absolute left-1/2 top-4 z-20 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow-lg dark:border-red-500/20 dark:text-red-400">
          <span className="flex-1">⚠️ {edgeError}</span>
          <button onClick={() => setEdgeError(null)} className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-300">
            <X size={13} />
          </button>
        </div>
      )}
      {contextMenu && onApplyCommands && (
        // The "right-click empty canvas -> add it here" complement to the
        // toolbar palette — same PaletteTiles content, just anchored at
        // the click point instead of under the "+" button, and placing
        // directly at that point instead of falling back to the
        // incremental layout's guess.
        <div
          className="animate-fade-in absolute z-40 rounded-xl bg-surface shadow-raised"
          style={{ left: contextMenu.localX, top: contextMenu.localY }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <PaletteTiles
            activeKind={contextMenuKind}
            onKindChange={setContextMenuKind}
            onPick={(sel) => {
              void handlePaletteAdd(sel.kind, sel.type, { x: contextMenu.flowX, y: contextMenu.flowY });
              setContextMenu(null);
            }}
          />
        </div>
      )}
      {simDock && <SimulationDock {...simDock} result={simulation ?? null} />}
      <CanvasLoadingOverlay active={busy} />
      <div className={`absolute right-3.5 z-10 flex items-center gap-2 ${nodes.length > 5 ? "top-14" : "top-3.5"}`}>
        {(onUndo || onRedo) && (
          <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-surface/90 shadow-soft backdrop-blur-sm dark:border-slate-700 dark:bg-surface/90">
            <IconButton
              onClick={onUndo}
              disabled={busy || !canUndo}
              className="rounded-none"
              title="Undo last change (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </IconButton>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
            <IconButton
              onClick={onRedo}
              disabled={busy || !canRedo}
              className="rounded-none"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 size={14} />
            </IconButton>
          </div>
        )}
        {onApplyCommands && <ComponentPalette onPick={(sel) => void handlePaletteAdd(sel.kind, sel.type)} disabled={busy} />}
        <ExportMenu flowElementRef={flowWrapperRef} projectName={projectName ?? "architecture"} onShare={onShare} projectId={projectId} versionId={versionId} />
      </div>
    </div>
  );
}
