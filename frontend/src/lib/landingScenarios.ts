import type { ArchitectureState, SimulationResult } from "./types";
import type { LayoutMap } from "./layout";
import { NODE_HEIGHT, NODE_WIDTH, TRAFFIC_SOURCE_HEIGHT, TRAFFIC_SOURCE_WIDTH } from "./layout";

// Fixed illustrative fixtures for the landing page's live previews — real
// ArchitectureState / SimulationResult shapes (exactly what the backend
// actually returns from POST /chat and POST /projects/{id}/simulate), just
// authored by hand instead of computed, since there's no real project to
// simulate before a visitor has created one. Rendered through the same
// MiniArchitecturePreview -> ArchitectureCanvas pipeline (toFlowElements +
// applySimulation + the real ArchNodeCard/FlowEdge components) the actual
// product uses, so what a visitor sees here is pixel-for-pixel what the
// product itself renders, not a separate illustration of it.

// Column/row spacing mirrors lib/layout.ts's own dagre config (200x68
// nodes, ranksep 100, nodesep 40) so these hand-placed fixtures read as the
// product's real auto-layout, not a bespoke arrangement.
const COL = NODE_WIDTH + 100; // 300
const ROW = NODE_HEIGHT + 40; // 108

// --- Shared base topology: Storefront -> Gateway -> Orders API -> {DB, Cache}
const baseNodes: ArchitectureState["nodes"] = [
  { id: "n_store", node_kind: "service", name: "Storefront", type: "frontend", language: "TypeScript", scaling_mode: "stateless" },
  { id: "n_gw", node_kind: "infra_node", name: "API Gateway", type: "api_gateway" },
  { id: "n_orders", node_kind: "service", name: "Orders API", type: "service", language: "Go", scaling_mode: "stateless" },
  { id: "n_db", node_kind: "database", name: "PostgreSQL", type: "relational", engine: "postgres", role: "primary" },
  { id: "n_cache", node_kind: "database", name: "Redis", type: "keyvalue", engine: "redis", role: "cache" },
];

const baseEdges: ArchitectureState["edges"] = [
  { id: "e_store_gw", from_id: "n_store", to_id: "n_gw", protocol: "http", sync_async: "sync" },
  { id: "e_gw_orders", from_id: "n_gw", to_id: "n_orders", protocol: "http", sync_async: "sync" },
  { id: "e_orders_db", from_id: "n_orders", to_id: "n_db", protocol: "sql", sync_async: "sync" },
  { id: "e_orders_cache", from_id: "n_orders", to_id: "n_cache", protocol: "cache", sync_async: "async_" },
];

const baseLayout: LayoutMap = {
  n_store: { x: 0, y: 54 },
  n_gw: { x: COL, y: 54 },
  n_orders: { x: COL * 2, y: 54 },
  n_db: { x: COL * 3, y: 0 },
  n_cache: { x: COL * 3, y: ROW },
};

function baseState(extra?: { nodes: ArchitectureState["nodes"]; edges: ArchitectureState["edges"] }): ArchitectureState {
  return {
    nodes: [...baseNodes, ...(extra?.nodes ?? [])],
    edges: [...baseEdges, ...(extra?.edges ?? [])],
    constraints: [],
    adrs: [],
  };
}

export interface Scenario {
  id: string;
  fig: string;
  title: string;
  description: string;
  state: ArchitectureState;
  layout: LayoutMap;
  simulation: SimulationResult;
}

// --- Fig. 01 — hero: a real branching topology, not a flat chain -------
// A deliberately different shape from the shared base topology below —
// two columns by four rows, so it reads as a real branching diagram
// rather than either a thin flat chain or an overly tall vertical strip.
// Two real entry points (Storefront and API Gateway both have no
// incoming edge, by design) so simView.ts's own synthetic "Users" node —
// the same mechanism that already draws it for a live simulation on a
// real project — attaches to both automatically; API Gateway then fans
// out into a genuinely separate branch (Orders API vs. Inventory API,
// each with its own datastore) instead of one linear pipe.
//
// HGAP/VGAP, tuned together with the maxZoom={1.15} passed in
// Landing.tsx, are what the on-screen node size and spacing actually come
// from: at a representative container width this lands at roughly
// 220-240px-wide node cards and a ~480px total canvas height.
const HGAP = 48;
const VGAP = 30;
const HERO_COL_L = 0;
const HERO_COL_R = NODE_WIDTH + HGAP; // 248
const HERO_ROW_ENTRY = TRAFFIC_SOURCE_HEIGHT + VGAP; // Storefront / API Gateway
const HERO_ROW_BACKEND = HERO_ROW_ENTRY + NODE_HEIGHT + VGAP; // Orders API / Inventory API
const HERO_ROW_DATA = HERO_ROW_BACKEND + NODE_HEIGHT + VGAP; // PostgreSQL / Redis Cache

// Where the synthetic "Users" node (simView.ts's applySimulation) has to
// be placed for the branching layout to actually work: centered above the
// two entry nodes, row 0. Left to simView's own default — left of the
// entry nodes' average position, the heuristic its real left-to-right
// canvas use case needs — its edge to API Gateway would route straight
// across Storefront, which was the actual cause of the reported crossing
// lines (there's only ever one diagonal edge in this topology otherwise:
// API Gateway -> Orders API, with nothing else to cross).
export const HERO_USERS_POSITION = {
  x: (HERO_COL_L + HERO_COL_R + NODE_WIDTH) / 2 - TRAFFIC_SOURCE_WIDTH / 2,
  y: 0,
};

const heroNodes: ArchitectureState["nodes"] = [
  { id: "n_store", node_kind: "service", name: "Storefront", type: "frontend", language: "TypeScript", scaling_mode: "stateless" },
  { id: "n_gw", node_kind: "infra_node", name: "API Gateway", type: "api_gateway" },
  { id: "n_orders", node_kind: "service", name: "Orders API", type: "service", language: "Go", scaling_mode: "stateless" },
  { id: "n_inventory", node_kind: "service", name: "Inventory API", type: "service", language: "Go", scaling_mode: "stateless" },
  { id: "n_db", node_kind: "database", name: "PostgreSQL", type: "relational", engine: "postgres", role: "primary" },
  { id: "n_cache", node_kind: "database", name: "Redis Cache", type: "keyvalue", engine: "redis", role: "cache" },
];

const heroEdges: ArchitectureState["edges"] = [
  // Storefront has no downstream edge here on purpose — it's the one
  // user-facing entry point with nothing further to show in a
  // deliberately simple hero; API Gateway is the one that fans out into
  // the real backend topology beneath it.
  { id: "e_gw_orders", from_id: "n_gw", to_id: "n_orders", protocol: "http", sync_async: "sync" },
  { id: "e_gw_inventory", from_id: "n_gw", to_id: "n_inventory", protocol: "http", sync_async: "sync" },
  { id: "e_orders_db", from_id: "n_orders", to_id: "n_db", protocol: "sql", sync_async: "sync" },
  { id: "e_inventory_cache", from_id: "n_inventory", to_id: "n_cache", protocol: "cache", sync_async: "sync" },
];

const heroLayout: LayoutMap = {
  n_store: { x: HERO_COL_L, y: HERO_ROW_ENTRY },
  n_gw: { x: HERO_COL_R, y: HERO_ROW_ENTRY },
  n_orders: { x: HERO_COL_L, y: HERO_ROW_BACKEND },
  n_inventory: { x: HERO_COL_R, y: HERO_ROW_BACKEND },
  n_db: { x: HERO_COL_L, y: HERO_ROW_DATA },
  n_cache: { x: HERO_COL_R, y: HERO_ROW_DATA },
};

export const HERO_SCENARIO: Scenario = {
  id: "hero",
  fig: "Fig. 01",
  title: "Live architecture canvas",
  description: "Every node was proposed as a validated command, never drawn freehand.",
  state: { nodes: heroNodes, edges: heroEdges, constraints: [], adrs: [] },
  layout: heroLayout,
  simulation: {
    scenario: "steady_state",
    multiplier: 1,
    killed_node_ids: [],
    loads: [
      { node_id: "n_store", node_name: "Storefront", incoming_rps: 45, capacity_rps: 400, utilization_pct: 11, status: "ok", basis: "1 instance @ 400 rps" },
      { node_id: "n_gw", node_name: "API Gateway", incoming_rps: 60, capacity_rps: 800, utilization_pct: 8, status: "ok", basis: "1 instance @ 800 rps" },
      { node_id: "n_orders", node_name: "Orders API", incoming_rps: 35, capacity_rps: 250, utilization_pct: 14, status: "ok", basis: "1 instance @ 250 rps" },
      { node_id: "n_inventory", node_name: "Inventory API", incoming_rps: 25, capacity_rps: 300, utilization_pct: 8, status: "ok", basis: "1 instance @ 300 rps" },
      { node_id: "n_db", node_name: "PostgreSQL", incoming_rps: 20, capacity_rps: 300, utilization_pct: 7, status: "ok", basis: "1 instance @ 300 rps" },
      { node_id: "n_cache", node_name: "Redis Cache", incoming_rps: 18, capacity_rps: 2000, utilization_pct: 1, status: "ok", basis: "1 instance @ 2000 rps" },
    ],
    edge_loads: [
      { edge_id: "e_gw_orders", from_id: "n_gw", to_id: "n_orders", rps: 35 },
      { edge_id: "e_gw_inventory", from_id: "n_gw", to_id: "n_inventory", rps: 25 },
      { edge_id: "e_orders_db", from_id: "n_orders", to_id: "n_db", rps: 20 },
      { edge_id: "e_inventory_cache", from_id: "n_inventory", to_id: "n_cache", rps: 18 },
    ],
    findings: [],
  },
};

// --- Fig. 02 — overloaded under a traffic burst ----------------------------
export const OVERLOAD_SCENARIO: Scenario = {
  id: "overload",
  fig: "Fig. 02",
  title: "Overloaded under a 10x burst",
  description:
    "The same architecture, replayed at 10x baseline traffic. Orders API is the first thing to buckle — it's still a single instance rated for 250 rps taking 400 — and the database backs up right behind it. This is the same deterministic capacity model the app runs when you drag the traffic slider, not a guess.",
  state: baseState(),
  layout: baseLayout,
  simulation: {
    scenario: "traffic_burst",
    multiplier: 10,
    killed_node_ids: [],
    loads: [
      { node_id: "n_store", node_name: "Storefront", incoming_rps: 400, capacity_rps: 400, utilization_pct: 100, status: "warning", basis: "1 instance @ 400 rps" },
      { node_id: "n_gw", node_name: "API Gateway", incoming_rps: 400, capacity_rps: 800, utilization_pct: 50, status: "ok", basis: "1 instance @ 800 rps" },
      { node_id: "n_orders", node_name: "Orders API", incoming_rps: 400, capacity_rps: 250, utilization_pct: 160, status: "overloaded", basis: "1 instance @ 250 rps" },
      { node_id: "n_db", node_name: "PostgreSQL", incoming_rps: 220, capacity_rps: 300, utilization_pct: 73, status: "warning", basis: "1 instance @ 300 rps" },
      { node_id: "n_cache", node_name: "Redis", incoming_rps: 180, capacity_rps: 2000, utilization_pct: 9, status: "ok", basis: "1 instance @ 2000 rps" },
    ],
    edge_loads: [
      { edge_id: "e_store_gw", from_id: "n_store", to_id: "n_gw", rps: 400 },
      { edge_id: "e_gw_orders", from_id: "n_gw", to_id: "n_orders", rps: 400 },
      { edge_id: "e_orders_db", from_id: "n_orders", to_id: "n_db", rps: 220 },
      { edge_id: "e_orders_cache", from_id: "n_orders", to_id: "n_cache", rps: 180 },
    ],
    findings: [
      { order: 1, node_id: "n_orders", node_name: "Orders API", message: "Orders API is overloaded at 160% of rated capacity — requests will start queueing or failing." },
    ],
  },
};

// --- Fig. 03 — a load balancer fanning traffic across replicas -------------
const lbNodes: ArchitectureState["nodes"] = [
  { id: "n_lb", node_kind: "infra_node", name: "Load Balancer", type: "load_balancer" },
  { id: "n_orders_a", node_kind: "service", name: "Orders API — A", type: "service", language: "Go", scaling_mode: "stateless" },
  { id: "n_orders_b", node_kind: "service", name: "Orders API — B", type: "service", language: "Go", scaling_mode: "stateless" },
  { id: "n_orders_c", node_kind: "service", name: "Orders API — C", type: "service", language: "Go", scaling_mode: "stateless" },
  { id: "n_db2", node_kind: "database", name: "PostgreSQL", type: "relational", engine: "postgres", role: "primary" },
];
const lbEdges: ArchitectureState["edges"] = [
  { id: "e_lb_a", from_id: "n_lb", to_id: "n_orders_a", protocol: "http", sync_async: "sync" },
  { id: "e_lb_b", from_id: "n_lb", to_id: "n_orders_b", protocol: "http", sync_async: "sync" },
  { id: "e_lb_c", from_id: "n_lb", to_id: "n_orders_c", protocol: "http", sync_async: "sync" },
  { id: "e_a_db", from_id: "n_orders_a", to_id: "n_db2", protocol: "sql", sync_async: "sync" },
  { id: "e_b_db", from_id: "n_orders_b", to_id: "n_db2", protocol: "sql", sync_async: "sync" },
  { id: "e_c_db", from_id: "n_orders_c", to_id: "n_db2", protocol: "sql", sync_async: "sync" },
];

export const LOAD_BALANCER_SCENARIO: Scenario = {
  id: "load-balancer",
  fig: "Fig. 03",
  title: "Load balancer fan-out",
  description:
    "Ask for a production tier and the AI doesn't just resize one box — it introduces a real load balancer and splits the same 10x traffic three ways, so each replica sits comfortably under capacity instead of one instance taking the full load alone.",
  state: { nodes: lbNodes, edges: lbEdges, constraints: [], adrs: [] },
  layout: {
    n_lb: { x: 0, y: ROW },
    n_orders_a: { x: COL, y: 0 },
    n_orders_b: { x: COL, y: ROW },
    n_orders_c: { x: COL, y: ROW * 2 },
    n_db2: { x: COL * 2, y: ROW },
  },
  simulation: {
    scenario: "traffic_burst",
    multiplier: 10,
    killed_node_ids: [],
    loads: [
      { node_id: "n_lb", node_name: "Load Balancer", incoming_rps: 400, capacity_rps: 5000, utilization_pct: 8, status: "ok", basis: "1 instance @ 5000 rps" },
      { node_id: "n_orders_a", node_name: "Orders API — A", incoming_rps: 134, capacity_rps: 250, utilization_pct: 54, status: "ok", basis: "1 instance @ 250 rps" },
      { node_id: "n_orders_b", node_name: "Orders API — B", incoming_rps: 133, capacity_rps: 250, utilization_pct: 53, status: "ok", basis: "1 instance @ 250 rps" },
      { node_id: "n_orders_c", node_name: "Orders API — C", incoming_rps: 133, capacity_rps: 250, utilization_pct: 53, status: "ok", basis: "1 instance @ 250 rps" },
      { node_id: "n_db2", node_name: "PostgreSQL", incoming_rps: 400, capacity_rps: 900, utilization_pct: 44, status: "ok", basis: "3 instances @ 300 rps" },
    ],
    edge_loads: [
      { edge_id: "e_lb_a", from_id: "n_lb", to_id: "n_orders_a", rps: 134 },
      { edge_id: "e_lb_b", from_id: "n_lb", to_id: "n_orders_b", rps: 133 },
      { edge_id: "e_lb_c", from_id: "n_lb", to_id: "n_orders_c", rps: 133 },
      { edge_id: "e_a_db", from_id: "n_orders_a", to_id: "n_db2", rps: 134 },
      { edge_id: "e_b_db", from_id: "n_orders_b", to_id: "n_db2", rps: 133 },
      { edge_id: "e_c_db", from_id: "n_orders_c", to_id: "n_db2", rps: 133 },
    ],
    findings: [],
  },
};

// --- Fig. 04 — a hard dependency killed -------------------------------------
const killNodes: ArchitectureState["nodes"] = [
  { id: "n_payment", node_kind: "external_dependency", name: "Payment Provider", type: "payment", criticality: "hard" },
];
const killEdges: ArchitectureState["edges"] = [
  { id: "e_orders_payment", from_id: "n_orders", to_id: "n_payment", protocol: "http", sync_async: "sync" },
];

export const KILL_SCENARIO: Scenario = {
  id: "kill",
  fig: "Fig. 04",
  title: "A hard dependency killed",
  description:
    "Click any node in the real app to kill it mid-simulation. Here Payment Provider is a declared hard dependency — killing it doesn't just grey out that one box, the simulator traces the blast radius and flags exactly which upstream service now fails checkout.",
  state: baseState({ nodes: killNodes, edges: killEdges }),
  layout: { ...baseLayout, n_payment: { x: COL * 3, y: ROW * 2 } },
  simulation: {
    scenario: "dependency_killed",
    multiplier: 1,
    killed_node_ids: ["n_payment"],
    loads: [
      { node_id: "n_store", node_name: "Storefront", incoming_rps: 40, capacity_rps: 400, utilization_pct: 10, status: "ok", basis: "1 instance @ 400 rps" },
      { node_id: "n_gw", node_name: "API Gateway", incoming_rps: 40, capacity_rps: 800, utilization_pct: 5, status: "ok", basis: "1 instance @ 800 rps" },
      { node_id: "n_orders", node_name: "Orders API", incoming_rps: 40, capacity_rps: 250, utilization_pct: 16, status: "warning", basis: "1 instance @ 250 rps" },
      { node_id: "n_db", node_name: "PostgreSQL", incoming_rps: 22, capacity_rps: 300, utilization_pct: 7, status: "ok", basis: "1 instance @ 300 rps" },
      { node_id: "n_cache", node_name: "Redis", incoming_rps: 18, capacity_rps: 2000, utilization_pct: 1, status: "ok", basis: "1 instance @ 2000 rps" },
      { node_id: "n_payment", node_name: "Payment Provider", incoming_rps: 0, capacity_rps: 0, utilization_pct: 0, status: "killed", basis: "killed for this run" },
    ],
    edge_loads: [
      { edge_id: "e_store_gw", from_id: "n_store", to_id: "n_gw", rps: 40 },
      { edge_id: "e_gw_orders", from_id: "n_gw", to_id: "n_orders", rps: 40 },
      { edge_id: "e_orders_db", from_id: "n_orders", to_id: "n_db", rps: 22 },
      { edge_id: "e_orders_cache", from_id: "n_orders", to_id: "n_cache", rps: 18 },
      { edge_id: "e_orders_payment", from_id: "n_orders", to_id: "n_payment", rps: 0 },
    ],
    findings: [
      { order: 1, node_id: "n_orders", node_name: "Orders API", message: "Orders API calls Payment Provider synchronously as a hard dependency — checkout fails while it's down." },
    ],
  },
};

export const SCENARIOS: Scenario[] = [OVERLOAD_SCENARIO, LOAD_BALANCER_SCENARIO, KILL_SCENARIO];
