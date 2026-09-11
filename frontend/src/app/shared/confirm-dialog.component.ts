import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  input,
  output,
  viewChild,
} from "@angular/core";

import { IconComponent } from "./icon.component";

@Component({
  selector: "sa-confirm-dialog",
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    class="overlay"
    role="presentation"
    (mousedown)="onOverlayMouseDown($event)"
  >
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <header>
        <div class="icon-slot" [class.danger]="variant() === 'danger'">
          <sa-icon name="triangle-alert" [size]="18" />
        </div>
        <h2 id="confirm-title">{{ title() }}</h2>
      </header>
      <div class="body">
        <p id="confirm-message">{{ message() }}</p>
      </div>
      <footer>
        <button type="button" class="btn-ghost" (click)="dismiss.emit()">
          {{ cancelLabel() }}
        </button>
        <button
          #confirmButton
          type="button"
          [class.btn-danger]="variant() === 'danger'"
          [class.btn-primary]="variant() !== 'danger'"
          (click)="confirm.emit()"
        >
          {{ confirmLabel() }}
        </button>
      </footer>
    </div>
  </div>`,
  styles: [
    `
      .overlay {
        position: fixed;
        inset: 0;
        background: var(--sa-overlay);
        backdrop-filter: blur(6px);
        z-index: var(--sa-z-modal);
        display: grid;
        place-items: center;
        animation: fade-in 160ms ease-out;
      }
      @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .dialog {
        width: min(440px, calc(100vw - 32px));
        background: var(--sa-bg-elev);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-lg);
        box-shadow: var(--sa-shadow-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: pop-in 200ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes pop-in {
        from { opacity: 0; transform: translateY(6px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 18px 20px 6px;
      }
      .icon-slot {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: var(--sa-radius-md);
        background: var(--sa-surface);
        color: var(--sa-text-muted);
        flex-shrink: 0;
      }
      .icon-slot.danger {
        background: var(--sa-danger-soft);
        color: var(--sa-danger);
      }
      header h2 {
        font-size: var(--sa-fs-md);
        font-weight: 600;
        color: var(--sa-text);
      }
      .body {
        padding: 6px 20px 18px;
      }
      .body p {
        font-size: var(--sa-fs-sm);
        color: var(--sa-text-muted);
        line-height: var(--sa-line-base);
      }
      footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--sa-border);
        background: var(--sa-surface);
      }
      button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        font-size: var(--sa-fs-sm);
        font-weight: 500;
        border-radius: var(--sa-radius-md);
        transition: all var(--sa-transition-fast);
      }
      .btn-ghost {
        color: var(--sa-text-muted);
      }
      .btn-ghost:hover {
        background: var(--sa-surface-hover);
        color: var(--sa-text);
      }
      .btn-primary {
        background: var(--sa-accent);
        color: var(--sa-accent-text);
      }
      .btn-primary:hover {
        background: var(--sa-accent-hover);
      }
      .btn-danger {
        background: var(--sa-danger, #e5484d);
        color: #fff;
      }
      .btn-danger:hover {
        filter: brightness(1.08);
      }
    `,
  ],
})
export class ConfirmDialogComponent {
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input("Confirm");
  readonly cancelLabel = input("Cancel");
  readonly variant = input<"default" | "danger">("default");

  readonly confirm = output<void>();
  /** Emitted when the dialog is dismissed without confirming (cancel button, overlay click, Escape). */
  readonly dismiss = output<void>();

  private readonly confirmButton = viewChild.required<ElementRef<HTMLButtonElement>>("confirmButton");

  constructor() {
    // Move focus into the dialog once it is rendered so keyboard users land on
    // the primary action (replaces the `autofocus` attribute).
    afterNextRender(() => this.confirmButton().nativeElement.focus());
  }

  onOverlayMouseDown(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.dismiss.emit();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.dismiss.emit();
  }
}
