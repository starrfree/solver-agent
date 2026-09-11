import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from "@angular/core";

import {
  LedgerEntry,
  LedgerEntryStatus,
  LedgerEntryType,
} from "../../core/api/dto";
import { EmptyStateComponent } from "../../shared/empty-state.component";
import { IconComponent } from "../../shared/icon.component";
import { TypeBadgeComponent } from "../../shared/type-badge.component";
import {
  EMPTY_GRAPH_LAYOUT,
  GraphLayout,
  GraphNode,
  edgePathFromPoints,
  fallbackGridLayout,
  overlayEdgePath,
} from "./proof-graph-layout";
import { ProofGraphLayoutService } from "./proof-graph-layout.service";

const STATUS_COLOR: Record<LedgerEntryStatus, string> = {
  pending: "--sa-warning",
  accepted: "--sa-success",
  rejected: "--sa-danger",
  superseded: "--sa-text-subtle",
};

const TYPE_COLOR: Record<LedgerEntryType, string> = {
  assumption: "--sa-type-assumption",
  derivation: "--sa-type-derivation",
  result: "--sa-type-result",
  symbolic_computation: "--sa-type-symbolic",
  numerical_computation: "--sa-type-numerical",
  cy_analyst_computation: "--sa-type-cy-analyst",
  reference_lookup: "--sa-type-reference-seeker",
  verification: "--sa-type-verification",
  correction: "--sa-type-correction",
  final_answer: "--sa-type-final",
  problem_followup: "--sa-type-problem-followup",
};

const LEGEND_TYPES: { type: LedgerEntryType; label: string }[] = [
  { type: "assumption", label: "Assumption" },
  { type: "derivation", label: "Derivation" },
  { type: "result", label: "Result" },
  { type: "symbolic_computation", label: "Symbolic" },
  { type: "numerical_computation", label: "Numerical" },
  { type: "cy_analyst_computation", label: "Calabi-Yau" },
  { type: "reference_lookup", label: "References" },
  { type: "verification", label: "Verification" },
  { type: "correction", label: "Correction" },
  { type: "final_answer", label: "Final answer" },
  { type: "problem_followup", label: "Follow-up" },
];

interface RenderEdge {
  id: string;
  d: string;
  verification: boolean;
  active: boolean;
  faded: boolean;
}

interface RenderNode {
  node: GraphNode;
  accent: string;
  statusColor: string;
  selected: boolean;
  dimmed: boolean;
  hasArtifacts: boolean;
  fast: boolean;
}

interface MinimapNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  selected: boolean;
  dimmed: boolean;
}

interface MinimapModel {
  width: number;
  height: number;
  scale: number;
  nodes: MinimapNode[];
  view: { x: number; y: number; w: number; h: number };
}

const DEFAULT_MIN_ZOOM = 0.25;
/** Hard floor: below this, nodes are illegible specks anyway. */
const ABSOLUTE_MIN_ZOOM = 0.04;
const MAX_ZOOM = 2.4;
/** Below this zoom, node cards switch to the compact (LOD) rendering. */
const LOD_ZOOM_THRESHOLD = 0.45;
/** Minimap only appears once the graph is big enough to need it. */
const MINIMAP_MIN_NODES = 8;
const MINIMAP_MAX_WIDTH = 200;
const MINIMAP_MAX_HEIGHT = 132;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

@Component({
  selector: "sa-proof-graph",
  standalone: true,
  imports: [EmptyStateComponent, IconComponent, TypeBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./proof-graph.component.html",
  styleUrl: "./proof-graph.component.scss",
})
export class ProofGraphComponent {
  readonly entries = input.required<LedgerEntry[]>();
  readonly selectedId = input<string | null>(null);

  readonly selectEntry = output<string>();
  readonly openArtifacts = output<string>();

  readonly canvas = viewChild<ElementRef<SVGSVGElement>>("canvas");

  private readonly layoutService = inject(ProofGraphLayoutService);

  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly showVerification = signal(false);
  readonly legendOpen = signal(true);
  readonly hoveredId = signal<string | null>(null);
  readonly panning = signal(false);

  /**
   * Layout arrives asynchronously from the ELK worker. The previous layout
   * stays on screen until the new one lands, so live updates never flicker.
   */
  readonly layout = signal<GraphLayout>(EMPTY_GRAPH_LAYOUT);

  /** Canvas client size, tracked with a ResizeObserver. */
  private readonly viewSize = signal({ w: 0, h: 0 });

  /** Once the user pans/zooms we stop auto-fitting on data updates. */
  private userInteracted = false;
  private lastFitKey = "";
  /** Monotonic token so stale worker responses can never clobber newer ones. */
  private layoutVersion = 0;

  readonly hasEntries = computed(() => this.entries().length > 0);

  readonly zoomLabel = computed(() => `${Math.round(this.zoom() * 100)}%`);

  readonly lodFar = computed(() => this.zoom() < LOD_ZOOM_THRESHOLD);

  readonly hasVerificationEdges = computed(() =>
    this.layout().edges.some((e) => e.kind === "verification"),
  );

  private readonly nodeById = computed(() => {
    const map = new Map<string, GraphNode>();
    for (const n of this.layout().nodes) map.set(n.id, n);
    return map;
  });

  /**
   * The larger the graph, the further out the user may zoom: never above the
   * default floor, never below what is needed to frame the whole proof.
   */
  private readonly minZoom = computed(() => {
    const layout = this.layout();
    const { w, h } = this.viewSize();
    if (!layout.width || !layout.height || !w || !h) return DEFAULT_MIN_ZOOM;
    const fitScale = Math.min(w / layout.width, h / layout.height) * 0.8;
    return clamp(fitScale, ABSOLUTE_MIN_ZOOM, DEFAULT_MIN_ZOOM);
  });

  /**
   * Focus mode: when a step is selected, everything outside its dependency
   * cone (ancestors + descendants along normal edges) is dimmed.
   */
  private readonly focusSet = computed<Set<string> | null>(() => {
    const sel = this.selectedId();
    if (!sel || !this.nodeById().has(sel)) return null;
    const forward = new Map<string, string[]>();
    const reverse = new Map<string, string[]>();
    for (const e of this.layout().edges) {
      if (e.kind !== "normal") continue;
      (forward.get(e.from) ?? forward.set(e.from, []).get(e.from)!).push(e.to);
      (reverse.get(e.to) ?? reverse.set(e.to, []).get(e.to)!).push(e.from);
    }
    const set = new Set<string>([sel]);
    for (const adjacency of [reverse, forward]) {
      const queue = [sel];
      while (queue.length) {
        const id = queue.pop()!;
        for (const next of adjacency.get(id) ?? []) {
          if (set.has(next)) continue;
          set.add(next);
          queue.push(next);
        }
      }
    }
    return set;
  });

  /** Edges directly incident to a node (same rule for hover and selection). */
  private isIncidentEdge(
    edge: { from: string; to: string },
    nodeId: string | null,
  ): boolean {
    return nodeId !== null && (edge.from === nodeId || edge.to === nodeId);
  }

  readonly transform = computed(
    () => `translate(${this.panX()} ${this.panY()}) scale(${this.zoom()})`,
  );

  readonly renderEdges = computed<RenderEdge[]>(() => {
    const byId = this.nodeById();
    const sel = this.selectedId();
    const hov = this.hoveredId();
    const focus = this.focusSet();
    const showVerification = this.showVerification();
    const out: RenderEdge[] = [];
    for (const edge of this.layout().edges) {
      if (edge.kind === "verification" && !showVerification) continue;
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const d =
        edge.points && edge.points.length >= 2
          ? edgePathFromPoints(edge.points)
          : overlayEdgePath(from, to);
      const active =
        this.isIncidentEdge(edge, hov) || this.isIncidentEdge(edge, sel);
      const inFocus =
        focus === null || (focus.has(edge.from) && focus.has(edge.to));
      out.push({
        id: edge.id,
        d,
        verification: edge.kind === "verification",
        active,
        faded: !inFocus,
      });
    }
    return out;
  });

  readonly renderNodes = computed<RenderNode[]>(() => {
    const sel = this.selectedId();
    const focus = this.focusSet();
    return this.layout().nodes.map((node) => ({
      node,
      accent: `var(${TYPE_COLOR[node.entry.type] ?? "--sa-text-muted"})`,
      statusColor: `var(${STATUS_COLOR[node.entry.status] ?? "--sa-text-muted"})`,
      selected: node.id === sel,
      dimmed: focus !== null && !focus.has(node.id),
      hasArtifacts: hasArtifacts(node.entry),
      fast: node.entry.reasoningSpeed === "fast",
    }));
  });

  readonly minimap = computed<MinimapModel | null>(() => {
    const layout = this.layout();
    if (
      layout.nodes.length < MINIMAP_MIN_NODES ||
      !layout.width ||
      !layout.height
    ) {
      return null;
    }
    const scale = Math.min(
      MINIMAP_MAX_WIDTH / layout.width,
      MINIMAP_MAX_HEIGHT / layout.height,
    );
    const width = layout.width * scale;
    const height = layout.height * scale;
    const sel = this.selectedId();
    const focus = this.focusSet();
    const nodes: MinimapNode[] = layout.nodes.map((n) => ({
      id: n.id,
      x: n.x * scale,
      y: n.y * scale,
      w: Math.max(3, n.width * scale),
      h: Math.max(2.5, n.height * scale),
      color: `var(${TYPE_COLOR[n.entry.type] ?? "--sa-text-muted"})`,
      selected: n.id === sel,
      dimmed: focus !== null && !focus.has(n.id),
    }));

    const z = this.zoom();
    const { w: vw, h: vh } = this.viewSize();
    const x1 = clamp((-this.panX() / z) * scale, 0, width);
    const y1 = clamp((-this.panY() / z) * scale, 0, height);
    const x2 = clamp(((vw - this.panX()) / z) * scale, 0, width);
    const y2 = clamp(((vh - this.panY()) / z) * scale, 0, height);
    return {
      width,
      height,
      scale,
      nodes,
      view: { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) },
    };
  });

  readonly legendTypes = LEGEND_TYPES;

  /** Breathing room around each node so shadows / focus rings aren't clipped by the foreignObject. */
  readonly pad = 16;

  constructor() {
    // Request an ELK layout whenever the entries change; keep showing the
    // previous geometry until the worker responds.
    effect(() => {
      const entries = this.entries();
      untracked(() => this.requestLayout(entries));
    });

    // Track the canvas size for fit / minimap / min-zoom computations.
    effect((onCleanup) => {
      const el = this.canvas()?.nativeElement;
      if (!el) return;
      const update = () =>
        this.viewSize.set({ w: el.clientWidth, h: el.clientHeight });
      update();
      const observer = new ResizeObserver(update);
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });

    // Auto-fit when the graph first appears or when switching to a different
    // proof, unless the user has taken manual control of the viewport.
    effect(() => {
      const layout = this.layout();
      untracked(() => {
        if (layout.nodes.length === 0) {
          this.lastFitKey = "";
          this.userInteracted = false;
          return;
        }
        const firstId = layout.nodes[0]?.id ?? "";
        const isNewProof = firstId !== this.lastFitKey.split("|")[0];
        if (isNewProof) this.userInteracted = false;
        const key = `${firstId}|${layout.nodes.length}`;
        if (key === this.lastFitKey && this.userInteracted) return;
        this.lastFitKey = key;
        if (!this.userInteracted) {
          requestAnimationFrame(() => this.fit());
        }
      });
    });

    // Show full-verification fan-in links when a verification step is selected.
    effect(() => {
      const sel = this.selectedId();
      const node = sel ? this.nodeById().get(sel) : null;
      untracked(() => {
        this.showVerification.set(node?.entry.type === "verification");
      });
    });
  }

  private requestLayout(entries: LedgerEntry[]): void {
    const version = ++this.layoutVersion;
    if (entries.length === 0) {
      this.layout.set(EMPTY_GRAPH_LAYOUT);
      return;
    }
    // Cheap placeholder on the very first paint, before the worker responds.
    if (this.layout().nodes.length === 0) {
      this.layout.set(fallbackGridLayout(entries));
    }
    this.layoutService.layout(entries).then(
      (layout) => {
        if (version === this.layoutVersion) this.layout.set(layout);
      },
      (error: unknown) => {
        console.error("Proof graph layout failed", error);
      },
    );
  }

  legendColor(type: LedgerEntryType): string {
    return `var(${TYPE_COLOR[type] ?? "--sa-text-muted"})`;
  }

  onNodeClick(node: GraphNode, event: Event): void {
    event.stopPropagation();
    this.selectEntry.emit(node.id);
  }

  onNodeOpen(node: GraphNode, event: Event): void {
    event.stopPropagation();
    this.openArtifacts.emit(node.id);
  }

  onNodeEnter(id: string): void {
    this.hoveredId.set(id);
  }

  onNodeLeave(): void {
    this.hoveredId.set(null);
  }

  zoomIn(): void {
    this.zoomAtCenter(1.2);
  }

  zoomOut(): void {
    this.zoomAtCenter(1 / 1.2);
  }

  toggleVerification(): void {
    this.showVerification.update((v) => !v);
  }

  toggleLegend(): void {
    this.legendOpen.update((v) => !v);
  }

  fit(): void {
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const layout = this.layout();
    if (!layout.nodes.length || vw === 0 || vh === 0) return;
    const margin = 36;
    const scale = clamp(
      Math.min((vw - margin * 2) / layout.width, (vh - margin * 2) / layout.height),
      this.minZoom(),
      1.3,
    );
    this.zoom.set(scale);
    this.panX.set((vw - layout.width * scale) / 2);
    this.panY.set(Math.max(margin, (vh - layout.height * scale) / 2));
  }

  resetView(): void {
    this.userInteracted = false;
    this.fit();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.userInteracted = true;
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const old = this.zoom();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = clamp(old * factor, this.minZoom(), MAX_ZOOM);
    if (next === old) return;
    const wx = (px - this.panX()) / old;
    const wy = (py - this.panY()) / old;
    this.panX.set(px - wx * next);
    this.panY.set(py - wy * next);
    this.zoom.set(next);
  }

  // --- Panning -------------------------------------------------------------
  private dragging = false;
  private moved = false;
  private startX = 0;
  private startY = 0;
  private startPanX = 0;
  private startPanY = 0;

  onBackgroundPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.dragging = true;
    this.moved = false;
    this.panning.set(false);
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startPanX = this.panX();
    this.startPanY = this.panY();
    (event.currentTarget as SVGSVGElement).setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    if (!this.moved && Math.hypot(dx, dy) > 3) {
      this.moved = true;
      this.panning.set(true);
      this.userInteracted = true;
      clearDocumentSelection();
    }
    if (this.moved) {
      event.preventDefault();
      this.panX.set(this.startPanX + dx);
      this.panY.set(this.startPanY + dy);
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.dragging) return;
    const wasDrag = this.moved;
    this.dragging = false;
    this.moved = false;
    this.panning.set(false);
    (event.currentTarget as SVGSVGElement).releasePointerCapture?.(event.pointerId);
    // A clean background click (no drag) clears the focus selection.
    if (!wasDrag && this.selectedId()) this.selectEntry.emit("");
  }

  onSelectStart(event: Event): void {
    event.preventDefault();
  }

  // --- Minimap ---------------------------------------------------------------
  private minimapDragging = false;

  onMinimapPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.minimapDragging = true;
    (event.currentTarget as SVGSVGElement).setPointerCapture?.(event.pointerId);
    this.panToMinimapPoint(event);
  }

  onMinimapPointerMove(event: PointerEvent): void {
    if (!this.minimapDragging) return;
    event.preventDefault();
    this.panToMinimapPoint(event);
  }

  onMinimapPointerUp(event: PointerEvent): void {
    if (!this.minimapDragging) return;
    this.minimapDragging = false;
    (event.currentTarget as SVGSVGElement).releasePointerCapture?.(event.pointerId);
  }

  /** Center the viewport on the world point under the minimap cursor. */
  private panToMinimapPoint(event: PointerEvent): void {
    const mm = this.minimap();
    if (!mm) return;
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const wx = (event.clientX - rect.left) / mm.scale;
    const wy = (event.clientY - rect.top) / mm.scale;
    const { w: vw, h: vh } = this.viewSize();
    const z = this.zoom();
    this.userInteracted = true;
    this.panX.set(vw / 2 - wx * z);
    this.panY.set(vh / 2 - wy * z);
  }

  private zoomAtCenter(factor: number): void {
    const el = this.canvas()?.nativeElement;
    this.userInteracted = true;
    const old = this.zoom();
    const next = clamp(old * factor, this.minZoom(), MAX_ZOOM);
    if (next === old) return;
    const vw = el?.clientWidth ?? 0;
    const vh = el?.clientHeight ?? 0;
    const cx = vw / 2;
    const cy = vh / 2;
    const wx = (cx - this.panX()) / old;
    const wy = (cy - this.panY()) / old;
    this.panX.set(cx - wx * next);
    this.panY.set(cy - wy * next);
    this.zoom.set(next);
  }
}

function hasArtifacts(entry: LedgerEntry): boolean {
  const a = entry.artifacts;
  if (!a) return false;
  return Boolean(a.code || a.stdout || a.stderr || (a.files && a.files.length > 0));
}

function clearDocumentSelection(): void {
  window.getSelection()?.removeAllRanges();
}
