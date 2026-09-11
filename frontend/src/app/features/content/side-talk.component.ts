import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";

import { ApiService } from "../../core/api/api.service";
import { DraftStoreService } from "../../core/state/draft-store.service";
import {
  SideTalkArtifactRef,
  SideTalkEntryRef,
  SideTalkMessage,
} from "../../core/api/dto";
import { absoluteTime } from "../../core/utils/time";
import { CopyButtonComponent } from "../../shared/copy-button.component";
import { IconComponent } from "../../shared/icon.component";
import { MarkdownComponent } from "../../shared/markdown.component";
import { SpinnerComponent } from "../../shared/spinner.component";

/**
 * A self-contained "side-talk" panel: an off-the-record mini-chat where the
 * user can ask the solver model questions about the ongoing work. It never
 * touches the ledger or the solver pipeline — it posts to a dedicated endpoint
 * and keeps its own local, persisted history. Shown in place of the main
 * timeline when the user toggles the side-talk view.
 */
@Component({
  selector: "sa-side-talk",
  standalone: true,
  imports: [
    FormsModule,
    CopyButtonComponent,
    IconComponent,
    MarkdownComponent,
    SpinnerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="side-talk">
      <div class="head">
        <div class="title">
          <sa-icon name="messages-square" [size]="15" />
          <span>Side-talk</span>
          <span class="subtitle">Ask about this problem — off the record, no verification process.</span>
        </div>
        @if (messages().length > 0) {
          <button
            type="button"
            class="clear-btn"
            (click)="clearAll()"
            [disabled]="clearing()"
            title="Delete this side-talk"
          >
            <sa-icon name="trash-2" [size]="13" />
            <span>Clear</span>
          </button>
        }
      </div>

      <div class="body" #scroller>
        @if (loading()) {
          <div class="state">
            <sa-spinner [size]="20" />
            <p>Loading…</p>
          </div>
        } @else if (messages().length === 0 && !asking()) {
          <div class="state">
            <sa-icon name="messages-square" [size]="22" />
            <p>
              Ask anything about this problem or the discussion so far — what an
              assumption means, how the approach works, what the current status is.
              Answers here don't affect the ledger.
            </p>
          </div>
        } @else {
          <div class="thread">
            @for (m of messages(); track m._id) {
              <article class="msg" [class.user]="m.role === 'user'">
                <div class="meta">
                  <span class="role">{{ m.role === "user" ? "You" : "Solver Agent" }}</span>
                  <span class="dot">·</span>
                  <span class="ts">{{ absolute(m.createdAt) }}</span>
                  <button
                    type="button"
                    class="del"
                    (click)="deleteOne(m._id)"
                    title="Delete this message"
                    aria-label="Delete this message"
                  >
                    <sa-icon name="trash-2" [size]="12" />
                  </button>
                </div>
                <div class="bubble">
                  <sa-markdown
                    [source]="m.content"
                    [collapsibleCode]="true"
                    [escapeHtml]="m.role === 'user'"
                  />
                  <div class="actions">
                    <sa-copy-button [value]="m.content" title="Copy (with LaTeX)" />
                  </div>
                </div>
                @if (m.role !== "user" && hasRefs(m)) {
                  <div class="refs">
                    <span class="refs-label">Loaded</span>
                    @for (e of m.loadedEntries ?? []; track e.entryId) {
                      <button
                        type="button"
                        class="ref-chip entry"
                        (click)="jumpToEntry.emit(e.entryId)"
                        [title]="'Go to step — ' + e.summary"
                      >
                        <sa-icon name="link" [size]="12" />
                        <span>{{ entryLabel(e) }}</span>
                      </button>
                    }
                    @for (a of m.loadedArtifacts ?? []; track a.fileId) {
                      <button
                        type="button"
                        class="ref-chip artifact"
                        (click)="openArtifact.emit(a.entryId)"
                        [title]="'Open artifact — ' + a.name"
                      >
                        <sa-icon [name]="artifactIcon(a)" [size]="12" />
                        <span>{{ a.name }}</span>
                      </button>
                    }
                  </div>
                }
              </article>
            }
            @if (asking()) {
              <article class="msg pending">
                <div class="meta">
                  <span class="role">Solver Agent</span>
                </div>
                <div class="bubble thinking">
                  <sa-spinner [size]="16" />
                  <span>Thinking…</span>
                </div>
              </article>
            }
          </div>
        }

        @if (error()) {
          <div class="err">
            <sa-icon name="triangle-alert" [size]="14" />
            <span>{{ error() }}</span>
          </div>
        }
      </div>

      <form class="composer" (submit)="$event.preventDefault(); send()">
        <div class="wrap">
          <button
            type="button"
            class="web-toggle"
            [class.active]="webSearch()"
            (click)="toggleWebSearch()"
            [attr.aria-pressed]="webSearch()"
            [title]="
              webSearch()
                ? 'Web search on — the model can look things up online'
                : 'Web search off — turn on to let the model search the web'
            "
          >
            <sa-icon name="globe" [size]="16" />
          </button>
          <textarea
            #textarea
            rows="1"
            [ngModel]="text()"
            (ngModelChange)="onTextChange($event)"
            name="content"
            [disabled]="!conversationId()"
            placeholder="Ask a question about this problem (⌘/Ctrl + Enter to send)"
            (input)="autoGrow()"
            (keydown)="onKeyDown($event)"
          ></textarea>
          <button
            type="submit"
            class="send"
            [disabled]="!canSend()"
            aria-label="Send"
            title="Send"
          >
            @if (asking()) {
              <sa-icon name="loader-2" [size]="16" />
            } @else {
              <sa-icon name="arrow-up" [size]="16" [strokeWidth]="2.2" />
            }
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
      }
      .side-talk {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 24px;
        border-bottom: 1px solid var(--sa-border);
        flex: 0 0 auto;
      }
      .title {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: var(--sa-fs-sm);
        color: var(--sa-text);
      }
      .subtitle {
        font-weight: 400;
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-muted);
      }
      .clear-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: var(--sa-radius-md);
        border: 1px solid var(--sa-border);
        background: var(--sa-surface);
        color: var(--sa-text-muted);
        font-size: var(--sa-fs-xs);
        cursor: pointer;
        transition: color var(--sa-transition-fast), border-color var(--sa-transition-fast);
      }
      .clear-btn:hover:not(:disabled) {
        color: var(--sa-danger, #d33);
        border-color: var(--sa-danger, #d33);
      }
      .clear-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 24px 32px 24px;
      }
      .thread {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 880px;
        margin: 0 auto;
      }
      .msg {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
      }
      .role {
        color: var(--sa-text-muted);
        font-weight: 600;
      }
      .ts {
        font-variant-numeric: tabular-nums;
      }
      .del {
        margin-left: 4px;
        display: inline-flex;
        align-items: center;
        border: none;
        background: transparent;
        color: var(--sa-text-subtle);
        cursor: pointer;
        opacity: 0;
        transition: opacity var(--sa-transition-fast), color var(--sa-transition-fast);
      }
      .msg:hover .del {
        opacity: 1;
      }
      .del:hover {
        color: var(--sa-danger, #d33);
      }
      .bubble {
        position: relative;
        padding: 16px 24px;
        border-radius: var(--sa-radius-lg);
        background: var(--sa-surface);
        border: 1px solid var(--sa-border);
      }
      .msg.user .bubble {
        background: var(--sa-accent-soft);
        border-color: transparent;
      }
      .bubble ::ng-deep img {
        max-width: 100%;
        height: auto;
      }
      .bubble.thinking {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--sa-text-muted);
        font-size: var(--sa-fs-sm);
      }
      .actions {
        position: absolute;
        right: 6px;
        bottom: 6px;
        opacity: 0;
        transition: opacity var(--sa-transition-fast);
      }
      .bubble:hover .actions,
      .bubble:focus-within .actions {
        opacity: 1;
      }
      .refs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
        padding-left: 2px;
      }
      .refs-label {
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-right: 2px;
      }
      .ref-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 260px;
        padding: 3px 9px;
        border-radius: 999px;
        border: 1px solid var(--sa-border);
        background: var(--sa-surface);
        color: var(--sa-text-muted);
        font-size: var(--sa-fs-xs);
        font-family: var(--sa-font-mono, monospace);
        cursor: pointer;
        transition: color var(--sa-transition-fast),
          border-color var(--sa-transition-fast),
          background var(--sa-transition-fast);
      }
      .ref-chip span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ref-chip sa-icon {
        flex: 0 0 auto;
      }
      .ref-chip:hover {
        color: var(--sa-accent);
        border-color: var(--sa-accent);
        background: var(--sa-accent-soft);
      }
      .ref-chip.artifact:hover {
        color: var(--sa-text);
      }
      .state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        text-align: center;
        color: var(--sa-text-muted);
        padding: 64px 24px;
        max-width: 520px;
        margin: 0 auto;
      }
      .err {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 16px auto 0;
        max-width: 880px;
        color: var(--sa-danger, #d33);
        font-size: var(--sa-fs-sm);
      }
      .composer {
        flex: 0 0 auto;
        padding: 12px 24px 18px;
        border-top: 1px solid var(--sa-border);
      }
      .wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: 880px;
        margin: 0 auto;
        padding: 6px;
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-lg);
        background: var(--sa-surface);
      }
      .web-toggle {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: var(--sa-radius-md);
        border: 1px solid transparent;
        background: transparent;
        color: var(--sa-text-subtle);
        cursor: pointer;
        transition: color var(--sa-transition-fast),
          background var(--sa-transition-fast),
          border-color var(--sa-transition-fast);
      }
      .web-toggle:hover {
        color: var(--sa-text-muted);
        background: var(--sa-surface-2, rgba(127, 127, 127, 0.1));
      }
      .web-toggle.active {
        color: var(--sa-accent);
        background: var(--sa-accent-soft);
        border-color: transparent;
      }
      textarea {
        flex: 1 1 auto;
        resize: none;
        border: none;
        outline: none;
        background: transparent;
        color: var(--sa-text);
        font: inherit;
        line-height: 1.5;
        padding: 6px 0;
        max-height: 220px;
        display: block;
      }
      .send {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: var(--sa-radius-md);
        border: none;
        background: var(--sa-accent);
        color: var(--sa-accent-contrast, #fff);
        cursor: pointer;
        transition: opacity var(--sa-transition-fast);
      }
      .send:disabled {
        opacity: 0.4;
        cursor: default;
      }
    `,
  ],
})
export class SideTalkComponent {
  private readonly api = inject(ApiService);
  private readonly drafts = inject(DraftStoreService);

  readonly conversationId = input<string | null>(null);

  /** Emits a ledger entry id to scroll to in the conversation timeline. */
  readonly jumpToEntry = output<string>();
  /** Emits the owning entry id to open in the artifacts panel. */
  readonly openArtifact = output<string>();

  readonly messages = signal<SideTalkMessage[]>([]);
  readonly loading = signal(false);
  readonly asking = signal(false);
  readonly clearing = signal(false);
  readonly error = signal<string | null>(null);
  /** Whether the model may use the hosted web-search tool. Persisted locally. */
  readonly webSearch = signal(SideTalkComponent.loadWebSearchPref());

  private static readonly WEB_SEARCH_KEY = "solver-agent.side-talk.webSearch";

  private static loadWebSearchPref(): boolean {
    try {
      return localStorage.getItem(SideTalkComponent.WEB_SEARCH_KEY) === "1";
    } catch {
      return false;
    }
  }

  readonly text = signal("");

  @ViewChild("textarea", { static: false })
  textareaEl?: ElementRef<HTMLTextAreaElement>;

  @ViewChild("scroller", { static: false })
  scroller?: ElementRef<HTMLDivElement>;

  readonly canSend = computed(() => !!this.conversationId() && !this.asking());

  constructor() {
    effect(() => {
      const id = this.conversationId();
      this.error.set(null);
      this.messages.set([]);
      this.text.set(id ? this.drafts.load(this.draftKey(id)) : "");
      if (!id) {
        this.loading.set(false);
        return;
      }
      this.loadMessages(id);
    });

    effect(() => {
      this.messages();
      this.asking();
      queueMicrotask(() => this.scrollToBottom());
    });
  }

  private loadMessages(id: string): void {
    this.loading.set(true);
    this.api.listSideTalk(id).subscribe({
      next: (res) => {
        if (this.conversationId() !== id) return;
        this.messages.set(res.messages);
        this.loading.set(false);
      },
      error: () => {
        if (this.conversationId() !== id) return;
        this.loading.set(false);
        this.error.set("Failed to load side-talk.");
      },
    });
  }

  private draftKey(id: string): string {
    return `side-talk.${id}`;
  }

  onTextChange(value: string): void {
    this.text.set(value);
    const id = this.conversationId();
    if (id) this.drafts.save(this.draftKey(id), value);
  }

  send(): void {
    const id = this.conversationId();
    const content = this.text().trim();
    if (!id || !content || this.asking()) return;

    this.error.set(null);
    this.asking.set(true);
    this.text.set("");
    this.drafts.clear(this.draftKey(id));
    queueMicrotask(() => this.resetTextarea());

    this.api.askSideTalk(id, content, this.webSearch()).subscribe({
      next: (res) => {
        if (this.conversationId() !== id) {
          this.asking.set(false);
          return;
        }
        this.messages.update((list) => [...list, res.userMessage, res.assistantMessage]);
        this.asking.set(false);
      },
      error: () => {
        if (this.conversationId() !== id) {
          this.asking.set(false);
          return;
        }
        this.asking.set(false);
        this.error.set("Failed to get a response. Please try again.");
        this.text.set(content);
        this.drafts.save(this.draftKey(id), content);
      },
    });
  }

  deleteOne(messageId: string): void {
    const id = this.conversationId();
    if (!id) return;
    const previous = this.messages();
    this.messages.update((list) => list.filter((m) => m._id !== messageId));
    this.api.deleteSideTalkMessage(id, messageId).subscribe({
      error: () => {
        if (this.conversationId() !== id) return;
        this.messages.set(previous);
        this.error.set("Failed to delete the message.");
      },
    });
  }

  clearAll(): void {
    const id = this.conversationId();
    if (!id || this.clearing()) return;
    const previous = this.messages();
    this.clearing.set(true);
    this.messages.set([]);
    this.api.clearSideTalk(id).subscribe({
      next: () => this.clearing.set(false),
      error: () => {
        this.clearing.set(false);
        if (this.conversationId() !== id) return;
        this.messages.set(previous);
        this.error.set("Failed to clear the side-talk.");
      },
    });
  }

  toggleWebSearch(): void {
    const next = !this.webSearch();
    this.webSearch.set(next);
    try {
      localStorage.setItem(SideTalkComponent.WEB_SEARCH_KEY, next ? "1" : "0");
    } catch {
      // ignore persistence failures
    }
  }

  absolute(ts: string): string {
    return absoluteTime(ts);
  }

  hasRefs(m: SideTalkMessage): boolean {
    return (
      (m.loadedEntries?.length ?? 0) > 0 || (m.loadedArtifacts?.length ?? 0) > 0
    );
  }

  entryLabel(ref: SideTalkEntryRef): string {
    const type = ref.entryType.replace(/_/g, " ");
    const summary = ref.summary.trim();
    if (!summary) return type;
    const short = summary.length > 36 ? `${summary.slice(0, 36)}…` : summary;
    return `${type}: ${short}`;
  }

  artifactIcon(ref: SideTalkArtifactRef): string {
    const isImage =
      ref.mimeType.startsWith("image/") ||
      /\.(png|jpe?g|gif|svg|webp)$/i.test(ref.name);
    return isImage ? "image" : "file";
  }

  autoGrow(): void {
    const el = this.textareaEl?.nativeElement;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }

  onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      this.send();
    }
  }

  private resetTextarea(): void {
    const el = this.textareaEl?.nativeElement;
    if (!el) return;
    el.style.height = "auto";
    el.focus();
  }

  private scrollToBottom(): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }
}
