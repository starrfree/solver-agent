import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";

import { ReasoningSpeed } from "../../core/api/dto";
import { DraftStoreService } from "../../core/state/draft-store.service";
import { IconComponent } from "../../shared/icon.component";

@Component({
  selector: "sa-composer",
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<form class="composer" (submit)="$event.preventDefault(); onSubmit()">
    <div class="wrap" [class.disabled]="archived()">
      <textarea
        #textarea
        rows="1"
        [ngModel]="text()"
        (ngModelChange)="onTextChange($event)"
        name="content"
        [disabled]="archived()"
        [placeholder]="placeholder()"
        (input)="autoGrow()"
        (keydown)="onKeyDown($event)"
      ></textarea>
      <div class="actions">
        <div class="tools">
          <button
            type="button"
            class="tools-btn"
            [class.active]="toolsOpen()"
            [class.on]="anyToolOn()"
            [disabled]="archived()"
            [attr.aria-pressed]="toolsOpen()"
            (click)="toggleTools()"
            title="Additional tools"
            aria-label="Additional tools"
          >
            <sa-icon name="sliders-horizontal" [size]="13" [strokeWidth]="2" />
            <span class="tools-label">Tools</span>
            @if (anyToolOn()) {
              <span class="tools-dot" aria-hidden="true"></span>
            }
          </button>

          @if (toolsOpen()) {
            <div class="tools-pop" role="dialog" aria-label="Additional tools">
              <div class="tools-pop-title">Additional tools</div>
              <button
                type="button"
                class="tool-row"
                role="switch"
                [attr.aria-checked]="cyAnalyst()"
                (click)="toggleCyAnalyst()"
              >
                <span class="tool-icon"><sa-icon name="shapes" [size]="15" /></span>
                <span class="tool-text">
                  <span class="tool-name">Calabi-Yau Analyst</span>
                  <span class="tool-desc">
                    CYTools-backed analysis of Calabi-Yau manifolds (polytopes,
                    Hodge numbers, intersection numbers, cones).
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
                <span class="tool-icon"><sa-icon name="globe" [size]="15" /></span>
                <span class="tool-text">
                  <span class="tool-name">Reference Seeker</span>
                  <span class="tool-desc">
                    Searches the web for references and sources; reports
                    findings with citations.
                  </span>
                </span>
                <span class="switch" [class.on]="referenceSeeker()" aria-hidden="true">
                  <span class="knob"></span>
                </span>
              </button>
            </div>
          }
        </div>
        <button
          type="button"
          class="speed"
          [class.is-fast]="reasoningSpeed() === 'fast'"
          [disabled]="archived()"
          (click)="toggleSpeed()"
          [attr.aria-label]="speedAriaLabel()"
          [title]="speedTitle()"
        >
          <sa-icon [name]="speedIcon()" [size]="13" [strokeWidth]="2" />
          <span class="speed-label">{{ speedLabel() }}</span>
        </button>
        <span class="hint">⌘⏎</span>
        @if (running() && !canSend()) {
          <button
            type="button"
            class="control pause"
            [disabled]="archived()"
            (click)="onPauseClick()"
            title="Pause solver"
            aria-label="Pause solver"
          >
            <sa-icon name="pause" [size]="14" [strokeWidth]="2.2" />
          </button>
        } @else if (paused() && !canSend()) {
          <button
            type="button"
            class="control resume"
            [disabled]="archived()"
            (click)="onResumeClick()"
            title="Resume solver"
            aria-label="Resume solver"
          >
            <sa-icon name="play" [size]="14" [strokeWidth]="2.2" />
          </button>
        }
        <button
          type="submit"
          class="send"
          [disabled]="!canSend()"
          [attr.aria-label]="sendAriaLabel()"
          [title]="sendTitle()"
        >
          @if (sending()) {
            <sa-icon name="loader-2" [size]="16" />
          } @else {
            <sa-icon name="arrow-up" [size]="16" [strokeWidth]="2.2" />
          }
        </button>
      </div>
    </div>
  </form>`,
  styleUrls: ["./composer.component.scss"],
})
export class ComposerComponent {
  /** True while the solver is actively running. */
  readonly running = input(false);
  /** True when the conversation is stopped and awaiting resume. */
  readonly paused = input(false);
  readonly archived = input(false);
  readonly reasoningSpeed = input.required<ReasoningSpeed>();
  /** Whether the Calabi-Yau Analyst tool is enabled for this conversation. */
  readonly cyAnalyst = input(false);
  /** Whether the Reference Seeker tool is enabled for this conversation. */
  readonly referenceSeeker = input(false);
  /**
   * Identifier (typically the conversation id) used to persist the draft in
   * localStorage. When null, drafts are not persisted.
   */
  readonly draftKey = input<string | null>(null);
  readonly send = output<string>();
  readonly pauseRequested = output<void>();
  readonly resumeRequested = output<void>();
  readonly reasoningSpeedChange = output<ReasoningSpeed>();
  readonly cyAnalystChange = output<boolean>();
  readonly referenceSeekerChange = output<boolean>();

  /** True when any opt-in tool is enabled (drives the Tools button state). */
  readonly anyToolOn = computed(() => this.cyAnalyst() || this.referenceSeeker());

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly drafts = inject(DraftStoreService);

  readonly text = signal("");
  readonly sending = signal(false);
  readonly toolsOpen = signal(false);

  private readonly storageKey = computed(() => {
    const key = this.draftKey();
    return key ? `composer.${key}` : null;
  });

  constructor() {
    // Restore the saved draft whenever the target conversation changes.
    effect(() => {
      const key = this.storageKey();
      this.text.set(key ? this.drafts.load(key) : "");
      queueMicrotask(() => this.autoGrow());
    });
  }

  readonly speedLabel = computed(() => (this.reasoningSpeed() === "fast" ? "Fast" : "High"));
  readonly speedIcon = computed(() => (this.reasoningSpeed() === "fast" ? "zap" : "brain"));
  readonly speedTitle = computed(() =>
    this.reasoningSpeed() === "fast"
      ? "Reasoning effort: fast. Click to switch to high."
      : "Reasoning effort: high (default). Click to switch to fast.",
  );
  readonly speedAriaLabel = computed(
    () => `Reasoning effort: ${this.speedLabel()}. Click to toggle.`,
  );

  @ViewChild("textarea", { static: true })
  textareaEl!: ElementRef<HTMLTextAreaElement>;

  readonly placeholder = computed(() => {
    if (this.archived()) return "This conversation is archived.";
    if (this.running()) {
      return "Reply now to interrupt the solver and add a follow-up (⌘/Ctrl + Enter to send)";
    }
    if (this.paused()) {
      return "Stopped. Type a follow-up and send to resume, or press play to resume as-is.";
    }
    return "Reply to the agent or refine the problem (⌘/Ctrl + Enter to send)";
  });

  readonly sendTitle = computed(() => {
    if (this.running()) return "Pause and send follow-up";
    if (this.paused()) return "Send follow-up and resume";
    return "Send";
  });

  readonly sendAriaLabel = computed(() => this.sendTitle());

  canSend(): boolean {
    return !this.archived() && this.text().trim().length > 0;
  }

  onTextChange(value: string): void {
    this.text.set(value);
    const key = this.storageKey();
    if (key) this.drafts.save(key, value);
  }

  autoGrow(): void {
    const el = this.textareaEl.nativeElement;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }

  onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      this.onSubmit();
    }
  }

  onSubmit(): void {
    if (!this.canSend()) return;
    const value = this.text().trim();
    this.send.emit(value);
    this.text.set("");
    const key = this.storageKey();
    if (key) this.drafts.clear(key);
    queueMicrotask(() => {
      const el = this.textareaEl.nativeElement;
      el.style.height = "auto";
      el.focus();
    });
  }

  onPauseClick(): void {
    if (this.archived()) return;
    this.pauseRequested.emit();
  }

  onResumeClick(): void {
    if (this.archived()) return;
    this.resumeRequested.emit();
  }

  toggleSpeed(): void {
    if (this.archived()) return;
    this.reasoningSpeedChange.emit(this.reasoningSpeed() === "fast" ? "high" : "fast");
  }

  toggleTools(): void {
    if (this.archived()) return;
    this.toolsOpen.update((v) => !v);
  }

  toggleCyAnalyst(): void {
    if (this.archived()) return;
    this.cyAnalystChange.emit(!this.cyAnalyst());
  }

  toggleReferenceSeeker(): void {
    if (this.archived()) return;
    this.referenceSeekerChange.emit(!this.referenceSeeker());
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    if (!this.toolsOpen()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.toolsOpen.set(false);
    }
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.toolsOpen()) this.toolsOpen.set(false);
  }
}
