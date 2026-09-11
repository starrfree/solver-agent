/**
 * Pure helpers for the proof dependence graph layout.
 *
 * Geometry is computed by ELK.js (layered / Sugiyama) inside a web worker
 * (`proof-graph-layout.worker.ts`). This module builds the ELK input graph
 * from ledger entries and converts ELK's output back into the `GraphLayout`
 * structure the component renders: prerequisite -> dependent, flowing left to
 * right, with edges routed around nodes.
 *
 * Kept free of Angular so it can be reasoned about and unit-tested in
 * isolation. Only ELK *types* are imported here — the ELK implementation
 * itself lives exclusively in the worker chunk.
 */
import type { ElkNode } from "elkjs/lib/elk-api";

import { LedgerEntry } from "../../core/api/dto";

export type GraphEdgeKind = "normal" | "verification";

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  entry: LedgerEntry;
  /** Top-left corner in layout coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge {
  id: string;
  /** Prerequisite entry id (sits further left). */
  from: string;
  /** Dependent entry id (sits further right). */
  to: string;
  kind: GraphEdgeKind;
  /**
   * Routed polyline from ELK (start, bends, end). Absent for `verification`
   * overlay edges, which are excluded from layout and drawn as curves from
   * the final node positions.
   */
  points?: GraphPoint[];
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

export const EMPTY_GRAPH_LAYOUT: GraphLayout = {
  nodes: [],
  edges: [],
  width: 0,
  height: 0,
};

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  /** Horizontal gap between layers (columns). */
  layerGap: number;
  /** Vertical gap between sibling nodes within a layer. */
  nodeGap: number;
  padding: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeWidth: 224,
  nodeHeight: 92,
  layerGap: 96,
  nodeGap: 48,
  padding: 56,
};

/**
 * A full-verification entry depends on every prior step. Those fan-in edges
 * are tagged `verification` (hidden by default) except the link from the
 * `final_answer` entry, which stays a normal always-visible edge.
 */
function isVerificationHub(entry: LedgerEntry): boolean {
  return entry.tool === "full_verification";
}

function byCreatedAt(a: LedgerEntry, b: LedgerEntry): number {
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  if (at !== bt) return at - bt;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

/** Classify `dependsOn` links, skipping dangling / self references. */
export function buildGraphEdges(entries: readonly LedgerEntry[]): GraphEdge[] {
  const byId = new Map<string, LedgerEntry>();
  for (const e of entries) byId.set(e._id, e);

  const edges: GraphEdge[] = [];
  for (const entry of entries) {
    const hub = isVerificationHub(entry);
    for (const dep of entry.dependsOn) {
      if (!byId.has(dep) || dep === entry._id) continue;
      const depEntry = byId.get(dep)!;
      // Full verification fans in from every prior step, but the link from the
      // final answer it verifies stays a normal edge — always visible.
      const kind: GraphEdgeKind =
        hub && depEntry.type !== "final_answer" ? "verification" : "normal";
      edges.push({ id: `${dep}->${entry._id}`, from: dep, to: entry._id, kind });
    }
  }
  return edges;
}

export interface ElkGraphInput {
  root: ElkNode;
  /** All classified edges (normal + verification), in ledger order. */
  edges: GraphEdge[];
  /** Chronologically ordered entries, matching `root.children` order. */
  entries: LedgerEntry[];
}

/**
 * Build the ELK input graph. Verification fan-in edges are excluded from the
 * layout (they would collapse the layering into one giant fan) and rendered
 * as overlay curves from the final node positions instead.
 */
export function buildElkGraph(
  entries: readonly LedgerEntry[],
  options: Partial<LayoutOptions> = {},
): ElkGraphInput {
  const opt = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const ordered = [...entries].sort(byCreatedAt);
  const edges = buildGraphEdges(ordered);

  const root: ElkNode = {
    id: "proof-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": `[top=${opt.padding},left=${opt.padding},bottom=${opt.padding},right=${opt.padding}]`,
      "elk.spacing.nodeNode": String(opt.nodeGap),
      "elk.spacing.edgeNode": "22",
      "elk.spacing.edgeEdge": "14",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(opt.layerGap),
      "elk.layered.spacing.edgeNodeBetweenLayers": "26",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      // Ledger entries arrive chronologically; using model order as the
      // tie-breaker keeps the layout stable across incremental updates.
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: ordered.map((entry) => ({
      id: entry._id,
      width: opt.nodeWidth,
      height: opt.nodeHeight,
    })),
    edges: edges
      .filter((e) => e.kind === "normal")
      .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };

  return { root, edges, entries: ordered };
}

/** Convert ELK's laid-out graph back into the render-ready `GraphLayout`. */
export function parseElkResult(
  root: ElkNode,
  entries: readonly LedgerEntry[],
  edges: readonly GraphEdge[],
): GraphLayout {
  const entryById = new Map<string, LedgerEntry>();
  for (const e of entries) entryById.set(e._id, e);

  const nodes: GraphNode[] = [];
  for (const child of root.children ?? []) {
    const entry = entryById.get(child.id);
    if (!entry) continue;
    nodes.push({
      id: child.id,
      entry,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? DEFAULT_LAYOUT_OPTIONS.nodeWidth,
      height: child.height ?? DEFAULT_LAYOUT_OPTIONS.nodeHeight,
    });
  }

  const pointsByEdgeId = new Map<string, GraphPoint[]>();
  for (const edge of root.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) continue;
    pointsByEdgeId.set(edge.id, [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ]);
  }

  return {
    nodes,
    edges: edges.map((e) => {
      const points = pointsByEdgeId.get(e.id);
      return points ? { ...e, points } : { ...e };
    }),
    width: root.width ?? 0,
    height: root.height ?? 0,
  };
}

/**
 * Cheap synchronous placement (chronological rows) shown only on the very
 * first paint, before the ELK worker chunk has loaded and responded.
 */
export function fallbackGridLayout(
  entries: readonly LedgerEntry[],
  options: Partial<LayoutOptions> = {},
): GraphLayout {
  const opt = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const ordered = [...entries].sort(byCreatedAt);
  if (ordered.length === 0) return EMPTY_GRAPH_LAYOUT;

  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.8)));
  const rows = Math.ceil(ordered.length / cols);
  const nodes = ordered.map((entry, i) => ({
    id: entry._id,
    entry,
    x: opt.padding + (i % cols) * (opt.nodeWidth + opt.layerGap),
    y: opt.padding + Math.floor(i / cols) * (opt.nodeHeight + opt.nodeGap),
    width: opt.nodeWidth,
    height: opt.nodeHeight,
  }));

  return {
    nodes,
    edges: buildGraphEdges(ordered),
    width: opt.padding * 2 + cols * opt.nodeWidth + (cols - 1) * opt.layerGap,
    height: opt.padding * 2 + rows * opt.nodeHeight + (rows - 1) * opt.nodeGap,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * SVG path through an ELK-routed orthogonal polyline, with corners rounded
 * for readability.
 */
export function edgePathFromPoints(points: readonly GraphPoint[], radius = 12): string {
  if (points.length < 2) return "";
  let d = `M ${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (!(r > 0.5) || inLen === 0 || outLen === 0) {
      d += ` L ${round(cur.x)} ${round(cur.y)}`;
      continue;
    }
    const inX = (cur.x - prev.x) / inLen;
    const inY = (cur.y - prev.y) / inLen;
    const outX = (next.x - cur.x) / outLen;
    const outY = (next.y - cur.y) / outLen;
    d +=
      ` L ${round(cur.x - inX * r)} ${round(cur.y - inY * r)}` +
      ` Q ${round(cur.x)} ${round(cur.y)}` +
      ` ${round(cur.x + outX * r)} ${round(cur.y + outY * r)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

/**
 * Curve for edges that are not part of the ELK layout (verification overlay,
 * and all edges of the pre-ELK fallback grid): right side of the prerequisite
 * to the left side of the dependent, bowing gently upward over long spans so
 * overlapping curves stay distinguishable.
 */
export function overlayEdgePath(from: GraphNode, to: GraphNode): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const dx = Math.max(36, (x2 - x1) * 0.5);
  const bow = Math.min(150, Math.max(0, (x2 - x1 - from.width) * 0.14));
  return (
    `M ${round(x1)} ${round(y1)}` +
    ` C ${round(x1 + dx)} ${round(y1 - bow)},` +
    ` ${round(x2 - dx)} ${round(y2 - bow)},` +
    ` ${round(x2)} ${round(y2)}`
  );
}
