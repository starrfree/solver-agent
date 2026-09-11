import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from "@angular/core";
import { Router } from "@angular/router";

import { ApiService } from "../../core/api/api.service";
import {
  ConversationMessage,
  LedgerEntry,
  ReasoningSpeed,
} from "../../core/api/dto";
import { ConversationStoreService } from "../../core/state/conversation-store.service";
import { LayoutService } from "../../core/state/layout.service";
import { EmptyStateComponent } from "../../shared/empty-state.component";
import { IconComponent } from "../../shared/icon.component";
import { ResizablePaneDirective } from "../../shared/resizable-pane.directive";
import { SpinnerComponent } from "../../shared/spinner.component";
import { StatusPillComponent } from "../../shared/status-pill.component";
import { AgentActivityComponent } from "./agent-activity.component";
import { ChatMessageComponent } from "./chat-message.component";
import { ComposerComponent } from "./composer.component";
import { ForkDialogComponent } from "./fork-dialog.component";
import { LedgerEntryCardComponent } from "./ledger-entry-card.component";
import { ProofGraphComponent } from "./proof-graph.component";
import { ReasoningProcessComponent } from "./reasoning-process.component";
import { SideTalkComponent } from "./side-talk.component";
import { UsageMeterComponent } from "./usage-meter.component";

/** Which primary view the content area is showing. */
type ContentView = "timeline" | "solution" | "graph";

/** Extract `filename="..."` from a `Content-Disposition: attachment` header. */
function parseAttachmentFileName(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

interface ForkTarget {
  /** ISO timestamp of the item the fork branches from (inclusive). */
  upToCreatedAt: string;
  /** Short description of the fork point, shown in the dialog. */
  label: string;
  /** True when forking from the assistant message that answers the problem. */
  markSolved: boolean;
}

interface TimelineMessageItem {
  kind: "message";
  id: string;
  ts: string;
  message: ConversationMessage;
}

interface TimelineEntryItem {
  kind: "entry";
  id: string;
  ts: string;
  entry: LedgerEntry;
}

type TimelineItem = TimelineMessageItem | TimelineEntryItem;

@Component({
  selector: "sa-content",
  standalone: true,
  imports: [
    AgentActivityComponent,
    ChatMessageComponent,
    LedgerEntryCardComponent,
    ComposerComponent,
    EmptyStateComponent,
    ForkDialogComponent,
    IconComponent,
    ProofGraphComponent,
    ReasoningProcessComponent,
    ResizablePaneDirective,
    SideTalkComponent,
    SpinnerComponent,
    StatusPillComponent,
    UsageMeterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./content.component.html",
  styleUrl: "./content.component.scss",
})
export class ContentComponent implements AfterViewChecked {
  protected readonly store = inject(ConversationStoreService);
  protected readonly layout = inject(LayoutService);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);

  @ViewChild("scroller", { static: false })
  scroller?: ElementRef<HTMLDivElement>;

  readonly conversation = this.store.selectedConversation;
  readonly messages = this.store.messages;
  readonly entries = this.store.ledgerEntries;
  readonly ledger = this.store.ledger;
  readonly streamStatus = this.store.streamStatus;
  readonly retryCount = this.store.streamRetryCount;
  readonly solverError = this.store.solverError;
  readonly loading = this.store.selectedLoading;
  readonly error = this.store.selectedError;
  readonly activeAgents = this.store.activeAgents;
  readonly usage = this.store.usage;
  readonly reasoningSpeed = this.store.selectedReasoningSpeed;
  readonly cyAnalyst = this.store.selectedCyAnalyst;
  readonly referenceSeeker = this.store.selectedReferenceSeeker;
  readonly isSolverRunning = this.store.isSolverRunning;
  readonly isPaused = this.store.isPaused;
  readonly isFailed = computed(() => this.conversation()?.status === "failed");

  readonly timeline = computed<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...this.messages().map(
        (m): TimelineMessageItem => ({
          kind: "message",
          id: m._id,
          ts: m.createdAt,
          message: m,
        }),
      ),
      ...this.entries().map(
        (e): TimelineEntryItem => ({
          kind: "entry",
          id: e._id,
          ts: e.createdAt,
          entry: e,
        }),
      ),
    ];
    items.sort((a, b) => {
      const at = new Date(a.ts).getTime();
      const bt = new Date(b.ts).getTime();
      return at - bt;
    });
    return items;
  });

  readonly archived = computed(() => this.conversation()?.status === "archived");

  /** Markdown walkthrough produced by the proof narrator (read-only). */
  readonly narrative = computed<string | null>(() => this.ledger()?.narrative ?? null);
  /** True while the proof narrator is still building the walkthrough. */
  readonly narrativeGenerating = computed(() =>
    this.activeAgents().includes("proof_narrator"),
  );
  /** True once the ledger reached a terminal solved/verified state. */
  readonly isSolved = computed(() => {
    const status = this.ledger()?.status;
    return status === "solved" || status === "verified";
  });
  /**
   * Show the "Solution" tab once the ledger is solved (so the user can trigger
   * the narrator on demand) or as soon as a walkthrough exists / is building.
   */
  readonly showReasoning = computed(
    () => this.isSolved() || !!this.narrative() || this.narrativeGenerating(),
  );
  readonly viewMode = signal<ContentView>("timeline");
  readonly reasoningOpen = computed(() => this.viewMode() === "solution");
  readonly graphOpen = computed(() => this.viewMode() === "graph");
  readonly sideTalkOpen = signal(false);
  readonly sideTalkWidth = signal(560);
  readonly conversationId = computed(() => this.conversation()?._id ?? null);

  /** True while the export bundle is being fetched. */
  readonly exporting = signal(false);
  /** Message of the last failed export, shown next to the button until retried. */
  readonly exportError = signal<string | null>(null);

  /** Target the fork dialog is currently open for (null when closed). */
  readonly forkTarget = signal<ForkTarget | null>(null);
  /** Suggested title for the fork, derived from the source conversation. */
  readonly forkDefaultTitle = computed(() => {
    const title = this.conversation()?.title;
    return title ? `Fork of ${title}` : "Forked conversation";
  });

  private readonly pendingForceScroll = signal(false);
  private needsDomScroll: "force" | "soft" | null = null;

  /**
   * Tracks which conversation the reasoning auto-open state was captured for.
   * The solution view only auto-opens when the proof narrator runs to
   * completion while this conversation is open — never merely because an
   * already-solved conversation (with a narrative) is selected.
   */
  private reasoningTrackedConvId: string | null | undefined = undefined;
  /** True once the proof narrator has been seen running for the open conversation. */
  private narratorRanLive = false;
  /** Guard so the solution view auto-opens at most once per conversation. */
  private solutionAutoOpened = false;

  constructor() {
    effect(() => {
      this.store.selectedConversationId();
      untracked(() => this.pendingForceScroll.set(true));
    });

    // Auto-open the solution view only when the proof narrator finishes a live
    // run for the currently open conversation. Selecting an already-solved
    // conversation (narrative present, narrator idle) leaves the timeline up.
    effect(() => {
      const convId = this.store.selectedConversationId();
      const narrative = this.narrative();
      const generating = this.narrativeGenerating();
      untracked(() => {
        if (convId !== this.reasoningTrackedConvId) {
          // Conversation switched: reset view + tracking state.
          this.reasoningTrackedConvId = convId;
          this.narratorRanLive = false;
          this.solutionAutoOpened = false;
          this.viewMode.set("timeline");
          this.sideTalkOpen.set(false);
          return;
        }
        // Remember the narrator actively ran while this conversation was open.
        if (generating) this.narratorRanLive = true;
        if (
          this.narratorRanLive &&
          !generating &&
          narrative &&
          !this.solutionAutoOpened
        ) {
          this.solutionAutoOpened = true;
          // Don't yank the user out of the graph if they're exploring it.
          if (this.viewMode() === "timeline") this.viewMode.set("solution");
        }
      });
    });

    effect(() => {
      this.timeline();
      this.activeAgents();

      if (untracked(() => this.pendingForceScroll())) {
        if (!this.loading() && this.timeline().length > 0) {
          this.pendingForceScroll.set(false);
          this.needsDomScroll = "force";
        }
      } else {
        this.needsDomScroll = "soft";
      }
    });
  }

  ngAfterViewChecked(): void {
    if (!this.needsDomScroll) return;
    const mode = this.needsDomScroll;
    this.needsDomScroll = null;
    if (mode === "force") {
      this.pinToBottom();
    } else {
      this.scrollToBottom();
    }
  }

  onSend(content: string): void {
    this.store.sendMessage(content);
  }

  onPause(): void {
    this.store.pause();
  }

  onResume(): void {
    this.store.resume();
  }

  onReasoningSpeedChange(speed: ReasoningSpeed): void {
    this.store.setReasoningSpeed(speed);
  }

  onCyAnalystChange(enabled: boolean): void {
    this.store.setCyAnalyst(enabled);
  }

  onReferenceSeekerChange(enabled: boolean): void {
    this.store.setReferenceSeeker(enabled);
  }

  onSelectEntry(id: string): void {
    this.store.selectEntry(id);
    this.layout.openArtifacts();
  }

  /** Open the fork dialog branching from a chat message. */
  onForkMessage(message: ConversationMessage): void {
    // The assistant message that answers the problem references the final
    // answer entry; forking from it reproduces a completed (solved) solution.
    const isAnswer =
      message.role === "assistant" && message.relatedEntries.length > 0;
    this.forkTarget.set({
      upToCreatedAt: message.createdAt,
      label: this.truncate(message.content),
      markSolved: isAnswer,
    });
  }

  /** Open the fork dialog branching from a ledger entry. */
  onForkEntry(entry: LedgerEntry): void {
    this.forkTarget.set({
      upToCreatedAt: entry.createdAt,
      label: entry.content.summary,
      markSolved: false,
    });
  }

  closeFork(): void {
    this.forkTarget.set(null);
  }

  confirmFork(payload: { title: string }): void {
    const target = this.forkTarget();
    const sourceId = this.conversation()?._id;
    if (!target || !sourceId) {
      this.closeFork();
      return;
    }
    this.store
      .forkConversation(sourceId, target.upToCreatedAt, payload.title, target.markSolved)
      .subscribe({
        next: (id) => {
          this.closeFork();
          void this.router.navigate(["/c", id]);
        },
        error: () => this.closeFork(),
      });
  }

  private truncate(text: string): string {
    const cleaned = text.replace(/\s+/g, " ").trim();
    return cleaned.length <= 140 ? cleaned : `${cleaned.slice(0, 137).trimEnd()}…`;
  }

  toggleReasoning(): void {
    this.viewMode.update((v) => (v === "solution" ? "timeline" : "solution"));
    if (this.viewMode() !== "timeline") this.sideTalkOpen.set(false);
  }

  /** Trigger (or regenerate) the proof-narrator walkthrough. */
  onGenerateNarrative(): void {
    if (this.narrativeGenerating()) return;
    this.store.generateNarrative();
  }

  toggleGraph(): void {
    this.viewMode.update((v) => (v === "graph" ? "timeline" : "graph"));
    if (this.viewMode() !== "timeline") this.sideTalkOpen.set(false);
  }

  toggleSideTalk(): void {
    this.sideTalkOpen.update((v) => !v);
    if (this.sideTalkOpen()) this.viewMode.set("timeline");
  }

  /**
   * Download the shareable record of this conversation as a zip (Markdown and
   * LaTeX reports, `ledger.json`, artifacts and code). Rendered server-side
   * from the database, no LLM call involved.
   */
  exportConversation(): void {
    const id = this.conversationId();
    if (!id || this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set(null);
    this.api.exportConversation(id).subscribe({
      next: (response) => {
        const blob = response.body ?? new Blob();
        const fileName =
          parseAttachmentFileName(response.headers.get("Content-Disposition")) ??
          `solver-agent-${id}.zip`;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        // Give the browser a tick to start the download before revoking.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.exporting.set(false);
      },
      error: (err: unknown) => {
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status?: number }).status
            : undefined;
        this.exportError.set(
          status ? `Export failed (HTTP ${status}).` : "Export failed. Is the backend running?",
        );
        this.exporting.set(false);
      },
    });
  }

  /**
   * Focus a step from the graph without popping the artifacts panel. An empty
   * id means a background click cleared the focus.
   */
  onGraphSelect(id: string): void {
    if (!id) {
      this.store.selectEntry(null);
      return;
    }
    if (this.store.selectedEntryId() !== id) {
      this.layout.suppressNextArtifactAutoOpen = true;
    }
    this.store.selectEntry(id);
  }

  setSideTalkWidth(width: number): void {
    this.sideTalkWidth.set(width);
  }

  /**
   * Scroll to and highlight a step in the timeline without revealing the
   * artifacts panel. Used by entry references (conversation related-entry chips
   * and side-talk "loaded entry" flags) — only an explicit artifact action
   * should pop the panel open. Suppress the one selection-driven auto-open
   * this selection would otherwise trigger.
   */
  onJumpTo(id: string): void {
    const root = this.scroller?.nativeElement;
    if (!root) return;
    if (this.store.selectedEntryId() !== id) {
      this.layout.suppressNextArtifactAutoOpen = true;
    }
    const target = root.querySelector(`[data-entry-id="${CSS.escape(id)}"]`);
    if (target) (target as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
    this.store.selectEntry(id);
  }

  unarchive(): void {
    const id = this.conversation()?._id;
    if (id) this.store.unarchive(id);
  }

  dismissError(): void {
    this.store.dismissSolverError();
  }

  private pinTimer: number | null = null;

  /**
   * Keep the scroller anchored to the bottom for ~1.2s, accommodating async
   * content growth (markdown/KaTeX rendering, web fonts, images, etc.).
   */
  private pinToBottom(): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;

    if (this.pinTimer !== null) {
      cancelAnimationFrame(this.pinTimer);
      this.pinTimer = null;
    }

    const start = performance.now();
    let lastHeight = -1;
    let stableSince = start;

    const tick = (now: number) => {
      const node = this.scroller?.nativeElement;
      if (!node) {
        this.pinTimer = null;
        return;
      }
      node.scrollTop = node.scrollHeight;
      if (node.scrollHeight !== lastHeight) {
        lastHeight = node.scrollHeight;
        stableSince = now;
      }
      const stableFor = now - stableSince;
      const totalElapsed = now - start;
      if (stableFor < 250 && totalElapsed < 1500) {
        this.pinTimer = requestAnimationFrame(tick);
      } else {
        this.pinTimer = null;
      }
    };

    this.pinTimer = requestAnimationFrame(tick);
  }

  private scrollToBottom(): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 240) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
