import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";

import { DEFAULT_REASONING_SPEED, ReasoningSpeed } from "../../core/api/dto";
import { DraftStoreService } from "../../core/state/draft-store.service";
import { IconComponent } from "../../shared/icon.component";

export interface NewConversationPayload {
  problem: string;
  reasoningSpeed: ReasoningSpeed;
  cyAnalyst: boolean;
  referenceSeeker: boolean;
}

@Component({
  selector: "sa-new-conversation-dialog",
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div
    class="overlay"
    role="presentation"
    (mousedown)="onOverlayMouseDown($event)"
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conv-title"
    >
      <header>
        <h2 id="new-conv-title">New problem</h2>
        <button type="button" class=" icon-btn" (click)="dismiss.emit()" aria-label="Close">
          <sa-icon name="x" [size]="18" />
        </button>
      </header>
      <div class="body">
        <label for="problem">Problem statement</label>
        <textarea
          #textarea
          id="problem"
          rows="6"
          [ngModel]="problem"
          (ngModelChange)="onProblemChange($event)"
          placeholder="Describe the physics or math problem the agent should solve, including any constraints, units and conventions."
          (keydown)="onKeyDown($event)"
        ></textarea>
        <p class="hint">Press <kbd>Cmd/Ctrl + Enter</kbd> to start.</p>

        <div class="effort">
          <span class="effort-label">Reasoning effort</span>
          <div class="segmented" role="radiogroup" aria-label="Reasoning effort">
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="reasoningSpeed() === 'high'"
              [class.is-active]="reasoningSpeed() === 'high'"
              (click)="setSpeed('high')"
            >
              <sa-icon name="brain" [size]="14" [strokeWidth]="2" />
              <span class="seg-text">
                <span class="seg-name">High</span>
                <span class="seg-desc">More thorough, may be token heavy.</span>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="reasoningSpeed() === 'fast'"
              [class.is-active]="reasoningSpeed() === 'fast'"
              (click)="setSpeed('fast')"
            >
              <sa-icon name="zap" [size]="14" [strokeWidth]="2" />
              <span class="seg-text">
                <span class="seg-name">Fast</span>
                <span class="seg-desc">Lower latency, usually cheaper.</span>
              </span>
            </button>
          </div>
        </div>

        <div class="tools">
          <span class="effort-label">Additional tools</span>
          <button
            type="button"
            class="tool-row"
            role="switch"
            [attr.aria-checked]="cyAnalyst()"
            (click)="toggleCyAnalyst()"
          >
            <span class="tool-icon"><sa-icon name="shapes" [size]="16" /></span>
            <span class="tool-text">
              <span class="tool-name">Calabi-Yau Analyst</span>
              <span class="tool-desc">
                Adds a CYTools-backed sub-agent specialized in Calabi-Yau
                manifolds — reflexive polytopes, triangulations, Hodge numbers,
                intersection numbers and Mori / Kähler cones.
              </span>
            </span>
            <span class="switch" [class.on]="cyAnalyst()" aria-hidden="true">
              <span class="knob"></span>
            </span>
          </button>
          <button
            type="button"
            class="tool-row"
            role="switch"
            [attr.aria-checked]="referenceSeeker()"
            (click)="toggleReferenceSeeker()"
          >
            <span class="tool-icon"><sa-icon name="globe" [size]="16" /></span>
            <span class="tool-text">
              <span class="tool-name">Reference Seeker</span>
              <span class="tool-desc">
                Adds a web-search-backed sub-agent that looks up references
                and sources online — it reports findings with citations or an
                explicit "not found".
              </span>
            </span>
            <span class="switch" [class.on]="referenceSeeker()" aria-hidden="true">
              <span class="knob"></span>
            </span>
          </button>
        </div>
      </div>
      <footer>
        <button type="button" class="btn-ghost" (click)="dismiss.emit()">Cancel</button>
        <button
          type="button"
          class="btn-primary"
          [disabled]="!canSubmit()"
          (click)="submit()"
        >
          Start solving
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
        width: min(560px, calc(100vw - 32px));
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
        font-size: var(--sa-fs-lg);
        font-weight: 600;
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
        gap: 8px;
      }
      label {
        font-size: var(--sa-fs-sm);
        color: var(--sa-text-muted);
        font-weight: 500;
      }
      textarea {
        width: 100%;
        min-height: 140px;
        max-height: 320px;
        padding: 12px 14px;
        background: var(--sa-bg);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        font-family: var(--sa-font-sans);
        font-size: var(--sa-fs-base);
        color: var(--sa-text);
        resize: vertical;
        line-height: var(--sa-line-base);
        transition: border-color var(--sa-transition-fast);
      }
      textarea:focus {
        border-color: var(--sa-accent);
      }
      .hint {
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
      }
      .hint kbd {
        font-family: var(--sa-font-mono);
        font-size: 0.9em;
        padding: 1px 5px;
        border-radius: 4px;
        background: var(--sa-surface-active);
        border: 1px solid var(--sa-border);
      }
      .effort {
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .effort-label {
        font-size: var(--sa-fs-sm);
        color: var(--sa-text-muted);
        font-weight: 500;
      }
      .segmented {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .segmented button {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: var(--sa-bg);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        text-align: left;
        color: var(--sa-text-muted);
        transition:
          border-color var(--sa-transition-fast),
          background var(--sa-transition-fast),
          color var(--sa-transition-fast);
      }
      .segmented button:hover:not(.is-active) {
        border-color: var(--sa-border-strong, var(--sa-text-subtle));
        color: var(--sa-text);
      }
      .segmented button.is-active {
        border-color: var(--sa-accent);
        background: var(--sa-accent-soft);
        color: var(--sa-text);
      }
      .seg-text {
        display: flex;
        flex-direction: column;
        line-height: 1.2;
      }
      .seg-name {
        font-size: var(--sa-fs-sm);
        font-weight: 600;
      }
      .seg-desc {
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
      }
      .segmented button.is-active .seg-desc {
        color: var(--sa-text-muted);
      }
      .tools {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tool-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px;
        background: var(--sa-bg);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        text-align: left;
        transition:
          border-color var(--sa-transition-fast),
          background var(--sa-transition-fast);
      }
      .tool-row:hover {
        border-color: var(--sa-border-strong, var(--sa-text-subtle));
      }
      .tool-row[aria-checked="true"] {
        border-color: var(--sa-accent);
        background: var(--sa-accent-soft);
      }
      .tool-icon {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        flex-shrink: 0;
        border-radius: var(--sa-radius-sm);
        background: var(--sa-surface);
        color: var(--sa-text-muted);
      }
      .tool-text {
        display: flex;
        flex-direction: column;
        gap: 3px;
        flex: 1 1 auto;
        min-width: 0;
      }
      .tool-name {
        font-size: var(--sa-fs-sm);
        font-weight: 600;
        color: var(--sa-text);
      }
      .tool-desc {
        font-size: var(--sa-fs-xs);
        line-height: 1.4;
        color: var(--sa-text-subtle);
      }
      .switch {
        position: relative;
        flex-shrink: 0;
        width: 36px;
        height: 21px;
        margin-top: 2px;
        border-radius: 999px;
        background: var(--sa-surface-active);
        border: 1px solid var(--sa-border);
        transition:
          background var(--sa-transition-fast),
          border-color var(--sa-transition-fast);
      }
      .switch .knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 15px;
        height: 15px;
        border-radius: 999px;
        background: var(--sa-text-subtle);
        transition:
          transform var(--sa-transition-fast),
          background var(--sa-transition-fast);
      }
      .switch.on {
        background: var(--sa-accent);
        border-color: var(--sa-accent);
      }
      .switch.on .knob {
        transform: translateX(15px);
        background: var(--sa-accent-text);
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
export class NewConversationDialogComponent implements AfterViewInit {
  private static readonly DRAFT_KEY = "new-conversation";

  private readonly drafts = inject(DraftStoreService);

  readonly dismiss = output<void>();
  readonly create = output<NewConversationPayload>();

  problem = this.drafts.load(NewConversationDialogComponent.DRAFT_KEY);
  readonly reasoningSpeed = signal<ReasoningSpeed>(DEFAULT_REASONING_SPEED);
  readonly cyAnalyst = signal(false);
  readonly referenceSeeker = signal(false);
  readonly busy = signal(false);

  @ViewChild("textarea", { static: true }) textareaEl!: ElementRef<HTMLTextAreaElement>;

  ngAfterViewInit(): void {
    setTimeout(() => this.textareaEl.nativeElement.focus(), 50);
  }

  canSubmit(): boolean {
    return this.problem.trim().length > 0 && !this.busy();
  }

  onProblemChange(value: string): void {
    this.problem = value;
    this.drafts.save(NewConversationDialogComponent.DRAFT_KEY, value);
  }

  setSpeed(speed: ReasoningSpeed): void {
    this.reasoningSpeed.set(speed);
  }

  toggleCyAnalyst(): void {
    this.cyAnalyst.update((v) => !v);
  }

  toggleReferenceSeeker(): void {
    this.referenceSeeker.update((v) => !v);
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.drafts.clear(NewConversationDialogComponent.DRAFT_KEY);
    this.create.emit({
      problem: this.problem.trim(),
      reasoningSpeed: this.reasoningSpeed(),
      cyAnalyst: this.cyAnalyst(),
      referenceSeeker: this.referenceSeeker(),
    });
  }

  onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
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
