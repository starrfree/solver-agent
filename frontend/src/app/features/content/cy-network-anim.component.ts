import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  signal,
} from "@angular/core";

interface Point {
  x: number;
  y: number;
}

const EDGES: readonly [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

/** Four-node complete graph (K₄) with gently drifting vertices. */
@Component({
  selector: "sa-cy-network-anim",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="network" viewBox="0 0 24 24" aria-hidden="true">
      @for (edge of edges(); track edge.key) {
        <line
          [attr.x1]="edge.x1"
          [attr.y1]="edge.y1"
          [attr.x2]="edge.x2"
          [attr.y2]="edge.y2"
        />
      }
      @for (point of points(); track $index) {
        <circle [attr.cx]="point.x" [attr.cy]="point.y" r="1.6" />
      }
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 200px;
        height: 200px;
        color: inherit;
      }
      .network {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }
      line {
        stroke: currentColor;
        stroke-width: 1.25;
        stroke-linecap: round;
        opacity: 0.85;
      }
      circle {
        fill: currentColor;
      }
    `,
  ],
})
export class CyNetworkAnimComponent implements OnInit, OnDestroy {
  readonly points = signal<Point[]>([
    { x: 8, y: 7 },
    { x: 16, y: 7 },
    { x: 9, y: 16 },
    { x: 15, y: 16 },
  ]);

  readonly edges = computed(() => {
    const pts = this.points();
    return EDGES.map(([a, b]) => ({
      key: `${a}-${b}`,
      x1: pts[a]!.x,
      y1: pts[a]!.y,
      x2: pts[b]!.x,
      y2: pts[b]!.y,
    }));
  });

  private frameId = 0;

  ngOnInit(): void {
    const tick = (time: number) => {
      const t = time * 0.001;
      const cx = 12;
      const cy = 12;
      const orbit = 5.2;

      this.points.set(
        Array.from({ length: 4 }, (_, i) => {
          const base = (i / 4) * Math.PI * 2;
          const wobble = Math.sin(t * 1.1 + i * 1.7) * 1.4;
          const angle = base + t * 0.55 + wobble * 0.15;
          const radius = orbit + Math.sin(t * 0.9 + i * 2.1) * 1.1;
          return {
            x: cx + Math.cos(angle) * radius + Math.sin(t * 1.3 + i) * 0.6,
            y: cy + Math.sin(angle) * radius + Math.cos(t * 1.15 + i * 1.3) * 0.6,
          };
        }),
      );

      this.frameId = requestAnimationFrame(tick);
    };

    this.frameId = requestAnimationFrame(tick);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frameId);
  }
}
