import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  effect,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";

import { IconComponent } from "../../shared/icon.component";

@Component({
  selector: "sa-fork-dialog",
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    class="overlay"
    role="presentation"
    (mousedown)="onOverlayMouseDown($event)"
  >
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="fork-title">
      <header>
        <h2 id="fork-title">
          <span class="fork-icon" aria-hidden="true">
            <sa-icon name="split" [size]="17" />
          </span>
          Fork conversation
        </h2>
        <button type="button" class="icon-btn" (click)="dismiss.emit()" aria-label="Close">
          <sa-icon name="x" [size]="18" />
        </button>
      </header>
      <div class="body">
        <p class="lead">
          Create a new conversation that copies everything up to this point.
          The original is left untouched.
        </p>
        @if (fromLabel()) {
          <div class="from">
            <span class="from-label">Forking from</span>
            <p class="from-text">{{ fromLabel() }}</p>
          </div>
        }
        <label for="fork-name">New conversation title</label>
        <input
          #titleInput
          id="fork-name"
          type="text"
          [(ngModel)]="title"
          (keydown)="onKeyDown($event)"
          placeholder="Title for the forked conversation"
        />
      </div>
      <footer>
        <button type="button" class="btn-ghost" (click)="dismiss.emit()">Cancel</button>
        <button
          type="button"
          class="btn-primary"
          [disabled]="!canSubmit()"
          (click)="submit()"
        >
          Create fork
          <sa-icon name="arrow-right" [size]="14" />
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
        width: min(480px, calc(100vw - 32px));
        max-height: calc(100vh - 64px);
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
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--sa-border);
      }
      header h2 {
        display: flex;
        align-items: center;
        gap: 9px;
        font-size: var(--sa-fs-lg);
        font-weight: 600;
      }
      .fork-icon {
        display: inline-flex;
        transform: rotate(90deg);
        color: var(--sa-accent);
      }
      .icon-btn {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border-radius: var(--sa-radius-md);
        color: var(--sa-text-muted);
      }
      .icon-btn:hover {
        background: var(--sa-surface-hover);
        color: var(--sa-text);
      }
      .body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .lead {
        font-size: var(--sa-fs-sm);
        color: var(--sa-text-muted);
        line-height: var(--sa-line-base);
      }
      .from {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
        background: var(--sa-bg);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        border-left: 3px solid var(--sa-accent);
      }
      .from-label {
        font-size: var(--sa-fs-xs);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--sa-text-subtle);
        font-weight: 600;
      }
      .from-text {
        font-size: var(--sa-fs-sm);
        color: var(--sa-text);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      label {
        font-size: var(--sa-fs-sm);
        color: var(--sa-text-muted);
        font-weight: 500;
        margin-top: 4px;
      }
      input {
        width: 100%;
        padding: 10px 14px;
        background: var(--sa-bg);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        font-family: var(--sa-font-sans);
        font-size: var(--sa-fs-base);
        color: var(--sa-text);
        transition: border-color var(--sa-transition-fast);
      }
      input:focus {
        border-color: var(--sa-accent);
      }
      footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 14px 20px;
        border-top: 1px solid var(--sa-border);
      }
      .btn-ghost,
      .btn-primary {
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
      .btn-primary:hover:not(:disabled) {
        background: var(--sa-accent-hover);
      }
      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class ForkDialogComponent implements AfterViewInit {
  /** Short description of the timeline item being forked from. */
  readonly fromLabel = input<string>("");
  /** Default title for the new conversation. */
  readonly defaultTitle = input<string>("");

  readonly dismiss = output<void>();
  readonly confirm = output<{ title: string }>();

  title = "";
  readonly busy = signal(false);

  @ViewChild("titleInput", { static: true })
  titleInputEl!: ElementRef<HTMLInputElement>;

  constructor() {
    effect(() => {
      this.title = this.defaultTitle();
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.titleInputEl.nativeElement.focus();
      this.titleInputEl.nativeElement.select();
    }, 50);
  }

  canSubmit(): boolean {
    return this.title.trim().length > 0 && !this.busy();
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.confirm.emit({ title: this.title.trim() });
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      this.submit();
    }
  }

  onOverlayMouseDown(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.dismiss.emit();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (!this.busy()) this.dismiss.emit();
  }
}
