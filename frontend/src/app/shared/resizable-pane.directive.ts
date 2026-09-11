import {
  Directive,
  ElementRef,
  HostListener,
  Input,
  Renderer2,
  inject,
  output,
} from "@angular/core";

export type ResizeEdge = "right" | "left";

/**
 * Drag-to-resize handle. Apply to the divider element; emits the new pane
 * width (in pixels) on every pointer move while dragging. The directive
 * itself does not mutate any width — the parent updates the bound width
 * signal which restyles the pane.
 *
 * Usage:
 *   <div saResizablePane [edge]="'right'" [min]="220" [max]="360"
 *        [base]="sidebarWidth()" (widthChange)="onSidebarResize($event)" />
 */
@Directive({
  selector: "[saResizablePane]",
  standalone: true,
})
export class ResizablePaneDirective {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly renderer = inject(Renderer2);

  @Input() edge: ResizeEdge = "right";
  @Input() min = 200;
  @Input() max = 600;
  /** The pane's current width before this drag started. */
  @Input() base = 280;

  readonly widthChange = output<number>();

  private dragging = false;
  private startX = 0;
  private startBase = 0;

  constructor() {
    this.renderer.setStyle(this.host.nativeElement, "cursor", "col-resize");
    this.renderer.setStyle(this.host.nativeElement, "user-select", "none");
    this.renderer.setStyle(this.host.nativeElement, "touch-action", "none");
  }

  @HostListener("pointerdown", ["$event"])
  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.dragging = true;
    this.startX = event.clientX;
    this.startBase = this.base;
    (event.target as Element).setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    event.preventDefault();
  }

  @HostListener("pointermove", ["$event"])
  onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    const delta = event.clientX - this.startX;
    const next =
      this.edge === "right" ? this.startBase + delta : this.startBase - delta;
    const clamped = Math.min(this.max, Math.max(this.min, Math.round(next)));
    this.widthChange.emit(clamped);
  }

  @HostListener("pointerup", ["$event"])
  @HostListener("pointercancel", ["$event"])
  onPointerUp(event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    try {
      (event.target as Element).releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    document.body.style.cursor = "";
  }
}
