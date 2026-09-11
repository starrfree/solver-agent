import { Injectable, computed, effect, inject, signal, untracked } from "@angular/core";
import { Observable, catchError, finalize, forkJoin, map, of, tap } from "rxjs";

import { ApiService } from "../api/api.service";
import {
  AdditionalTools,
  AgentTool,
  Conversation,
  ConversationMessage,
  ConversationStatus,
  ConversationUsage,
  DEFAULT_REASONING_SPEED,
  Ledger,
  LedgerEntry,
  ReasoningSpeed,
  SolverEvent,
} from "../api/dto";
import { StreamService } from "../api/stream.service";
import { UserService } from "./user.service";

export interface SolverErrorBanner {
  conversationId: string;
  code: string;
  message: string;
  ts: string;
}

@Injectable({ providedIn: "root" })
export class ConversationStoreService {
  private readonly api = inject(ApiService);
  private readonly stream = inject(StreamService);
  private readonly user = inject(UserService);

  readonly conversations = signal<Conversation[]>([]);
  readonly conversationsLoading = signal(false);
  readonly conversationsError = signal<string | null>(null);

  readonly selectedConversationId = signal<string | null>(null);
  readonly selectedLoading = signal(false);
  readonly selectedError = signal<string | null>(null);

  readonly ledger = signal<Ledger | null>(null);
  readonly ledgerEntries = signal<LedgerEntry[]>([]);
  readonly messages = signal<ConversationMessage[]>([]);

  readonly selectedEntryId = signal<string | null>(null);
  readonly solverError = signal<SolverErrorBanner | null>(null);

  /**
   * Running token/cost aggregate for the selected conversation. Hydrated from
   * the conversation document on load and kept live via `usage.updated` SSE
   * events. Null until known (or for legacy conversations without usage).
   */
  readonly usage = signal<ConversationUsage | null>(null);

  /**
   * Agents that are currently working on the selected conversation. Driven by
   * the `agent.activity` SSE events emitted around the main solver and each
   * sub-tool. Order is preserved using insertion in the underlying array so
   * the UI can render activity chips in a stable order.
   */
  readonly activeAgents = signal<readonly AgentTool[]>([]);

  /** Computed: the currently selected Conversation (or null). */
  readonly selectedConversation = computed<Conversation | null>(() => {
    const id = this.selectedConversationId();
    if (!id) return null;
    return this.conversations().find((c) => c._id === id) ?? null;
  });

  /**
   * Reasoning speed for the currently selected conversation. Falls back to
   * the default when no conversation is selected or the field is missing
   * on a legacy document.
   */
  readonly selectedReasoningSpeed = computed<ReasoningSpeed>(
    () => this.selectedConversation()?.reasoningSpeed ?? DEFAULT_REASONING_SPEED,
  );

  /**
   * Whether the Calabi-Yau Analyst tool is enabled for the currently selected
   * conversation. Defaults to `false` (opt-in) when no conversation is selected
   * or the field is missing on a legacy document.
   */
  readonly selectedCyAnalyst = computed<boolean>(
    () => this.selectedConversation()?.additionalTools?.cyAnalyst ?? false,
  );

  /**
   * Whether the Reference Seeker tool is enabled for the currently selected
   * conversation. Defaults to `false` (opt-in) when no conversation is
   * selected or the field is missing on a legacy document.
   */
  readonly selectedReferenceSeeker = computed<boolean>(
    () => this.selectedConversation()?.additionalTools?.referenceSeeker ?? false,
  );

  /** Computed: the currently selected ledger entry (or null). */
  readonly selectedEntry = computed<LedgerEntry | null>(() => {
    const id = this.selectedEntryId();
    if (!id) return null;
    return this.ledgerEntries().find((e) => e._id === id) ?? null;
  });

  /** Stream status mirror for templates. */
  readonly streamStatus = this.stream.status;
  readonly streamRetryCount = this.stream.retryCount;

  /** True while the SSE stream is open and the ledger isn't terminal. */
  readonly isSolverRunning = computed(() => {
    const ledger = this.ledger();
    if (!ledger) return false;
    if (ledger.status === "solved" || ledger.status === "verified") return false;
    if (ledger.status === "failed") return false;
    if (ledger.status === "paused") return false;
    const conv = this.selectedConversation();
    if (!conv) return false;
    if (conv.status === "failed") return false;
    if (conv.status === "solved") return false;
    if (conv.status === "archived") return false;
    if (conv?.status === "paused") return false;
    return true;
  });

  /** True when the conversation stopped and is awaiting user resume. */
  readonly isPaused = computed(() => {
    const conv = this.selectedConversation();
    if (!conv) return false;
    if (conv.status === "paused") return true;
    if (conv.status === "failed") return true;
    const ledgerStatus = this.ledger()?.status;
    return ledgerStatus === "paused" || ledgerStatus === "failed";
  });

  constructor() {
    effect(() => {
      const id = this.selectedConversationId();
      if (!id) {
        this.stream.disconnect();
        untracked(() => {
          this.ledger.set(null);
          this.ledgerEntries.set([]);
          this.messages.set([]);
          this.selectedEntryId.set(null);
          this.solverError.set(null);
          this.activeAgents.set([]);
          this.usage.set(null);
        });
        return;
      }
      untracked(() => this.loadConversationDetail(id));
      this.stream.connect(id, (event) => this.applyEvent(event));
    });
  }

  // --- High-level actions ------------------------------------------------

  loadConversations(): void {
    this.conversationsLoading.set(true);
    this.conversationsError.set(null);
    this.api
      .listConversations(this.user.userId())
      .pipe(
        catchError((err) => {
          this.conversationsError.set(this.formatError(err));
          return of({ conversations: [] as Conversation[] });
        }),
        finalize(() => this.conversationsLoading.set(false)),
      )
      .subscribe((res) => this.conversations.set(res.conversations));
  }

  selectConversation(id: string | null): void {
    if (this.selectedConversationId() === id) return;
    this.selectedConversationId.set(id);
  }

  createConversation(
    problemStatement: string,
    reasoningSpeed?: ReasoningSpeed,
    additionalTools?: AdditionalTools,
  ): Observable<string> {
    return this.api
      .createConversation({
        userId: this.user.userId(),
        problemStatement,
        ...(reasoningSpeed ? { reasoningSpeed } : {}),
        ...(additionalTools ? { additionalTools } : {}),
      })
      .pipe(
        tap((res) => {
          this.loadConversations();
          this.selectConversation(res.conversationId);
        }),
        map((res) => res.conversationId),
      );
  }

  /**
   * Fork an existing conversation into a brand-new one that copies all
   * content (messages + ledger entries) up to and including the timeline item
   * created at `upToCreatedAt`. Resolves with the new conversation id so the
   * caller can navigate to it.
   */
  forkConversation(
    sourceConversationId: string,
    upToCreatedAt: string,
    title?: string,
    markSolved?: boolean,
  ): Observable<string> {
    return this.api
      .forkConversation(sourceConversationId, {
        upToCreatedAt,
        ...(title ? { title } : {}),
        ...(markSolved ? { markSolved } : {}),
      })
      .pipe(
        tap((res) => {
          this.loadConversations();
          this.selectConversation(res.conversationId);
        }),
        map((res) => res.conversationId),
      );
  }

  sendMessage(content: string): void {
    const id = this.selectedConversationId();
    if (!id) return;
    // Always echo the current reasoning speed so the backend has it even if
    // a recent PATCH from the toggle hasn't landed yet.
    this.api
      .postMessage(id, content, {
        reasoningSpeed: this.selectedReasoningSpeed(),
        additionalTools: {
          cyAnalyst: this.selectedCyAnalyst(),
          referenceSeeker: this.selectedReferenceSeeker(),
        },
      })
      .subscribe();
  }

  setReasoningSpeed(speed: ReasoningSpeed): void {
    const id = this.selectedConversationId();
    if (!id) return;
    const previous = this.selectedConversation()?.reasoningSpeed;
    if (previous === speed) return;
    this.patchConversationLocal(id, { reasoningSpeed: speed });
    this.api.patchConversation(id, { reasoningSpeed: speed }).subscribe({
      error: () => {
        this.patchConversationLocal(id, { reasoningSpeed: previous });
      },
    });
  }

  /**
   * Toggle the Calabi-Yau Analyst tool for the selected conversation.
   * Optimistically patches the local conversation and PATCHes the backend,
   * rolling back on error — mirroring {@link setReasoningSpeed}.
   */
  setCyAnalyst(enabled: boolean): void {
    const id = this.selectedConversationId();
    if (!id) return;
    const previous = this.selectedConversation()?.additionalTools;
    if ((previous?.cyAnalyst ?? false) === enabled) return;
    const next: AdditionalTools = { ...previous, cyAnalyst: enabled };
    this.patchConversationLocal(id, { additionalTools: next });
    this.api.patchConversation(id, { additionalTools: next }).subscribe({
      error: () => {
        this.patchConversationLocal(id, { additionalTools: previous });
      },
    });
  }

  /**
   * Toggle the Reference Seeker tool for the selected conversation.
   * Optimistically patches the local conversation and PATCHes the backend,
   * rolling back on error — mirroring {@link setCyAnalyst}.
   */
  setReferenceSeeker(enabled: boolean): void {
    const id = this.selectedConversationId();
    if (!id) return;
    const previous = this.selectedConversation()?.additionalTools;
    if ((previous?.referenceSeeker ?? false) === enabled) return;
    const next: AdditionalTools = { ...previous, referenceSeeker: enabled };
    this.patchConversationLocal(id, { additionalTools: next });
    this.api.patchConversation(id, { additionalTools: next }).subscribe({
      error: () => {
        this.patchConversationLocal(id, { additionalTools: previous });
      },
    });
  }

  archive(id: string): void {
    this.api.patchConversation(id, { status: "archived" }).subscribe(() => {
      this.patchConversationLocal(id, { status: "archived" });
    });
  }

  /**
   * Ask the backend to interrupt the running solver. The status flip to
   * `paused` is delivered through the SSE stream once the orchestrator
   * settles the in-flight run.
   */
  pause(): void {
    const id = this.selectedConversationId();
    if (!id) return;
    this.api.pauseConversation(id).subscribe();
  }

  /**
   * Resume a paused (or interrupted) conversation. Triggers a fresh
   * Main Solver Agent run that rebuilds its input from the ledger.
   */
  resume(): void {
    const id = this.selectedConversationId();
    if (!id) return;
    this.api.resumeConversation(id).subscribe();
  }

  unarchive(id: string): void {
    this.api.patchConversation(id, { status: "active" }).subscribe(() => {
      this.patchConversationLocal(id, { status: "active" });
    });
  }

  /**
   * Trigger the Proof Narrator for the selected conversation. The walkthrough
   * builds in the background; the live "generating" state and the resulting
   * narrative are delivered over the SSE stream.
   */
  generateNarrative(): void {
    const id = this.selectedConversationId();
    if (!id) return;
    this.api.narrateConversation(id).subscribe({
      error: (err) => {
        this.solverError.set({
          conversationId: id,
          code: "narrator_request_failed",
          message: this.formatError(err),
          ts: new Date().toISOString(),
        });
      },
    });
  }

  /**
   * Delete a conversation and its associated ledger, ledger entries,
   * messages, and generated files. Returns an observable so the caller can
   * navigate away once the cascade has been acknowledged by the server.
   */
  deleteConversation(id: string): Observable<void> {
    return this.api.deleteConversation(id).pipe(
      tap(() => {
        const wasSelected = this.selectedConversationId() === id;
        this.conversations.update((list) => list.filter((c) => c._id !== id));
        if (wasSelected) {
          this.selectedConversationId.set(null);
        }
      }),
    );
  }

  selectEntry(id: string | null): void {
    this.selectedEntryId.set(id);
  }

  dismissSolverError(): void {
    this.solverError.set(null);
  }

  // --- Internals ---------------------------------------------------------

  private loadConversationDetail(id: string): void {
    this.selectedLoading.set(true);
    this.selectedError.set(null);
    this.solverError.set(null);
    this.selectedEntryId.set(null);
    this.activeAgents.set([]);
    this.usage.set(this.selectedConversation()?.usage ?? null);

    forkJoin({
      messages: this.api.listMessages(id),
      ledger: this.api.getLedger(id),
      entries: this.api.listEntries(id),
      usage: this.api.getUsage(id),
    })
      .pipe(
        catchError((err) => {
          this.selectedError.set(this.formatError(err));
          return of(null);
        }),
        finalize(() => this.selectedLoading.set(false)),
      )
      .subscribe((res) => {
        if (!res) return;
        this.messages.set(res.messages.messages);
        this.ledger.set(res.ledger.ledger);
        this.ledgerEntries.set(res.entries.entries);
        this.usage.set(res.usage.usage);
      });
  }

  private applyEvent(event: SolverEvent): void {
    switch (event.type) {
      case "ready": {
        if (!this.matchesSelected(event.conversationId)) return;
        // Hydrate the working-agents indicator from the server snapshot so the
        // UI reflects the truth even on (re)connect mid-run.
        this.activeAgents.set([...event.activeAgents]);
        return;
      }

      case "heartbeat":
        return;

      case "ledger.entry.added": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.ledgerEntries.update((list) => {
          if (list.some((e) => e._id === event.entry._id)) return list;
          return [...list, event.entry];
        });
        return;
      }

      case "ledger.entry.updated": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.ledgerEntries.update((list) =>
          list.map((e) => (e._id === event.entry._id ? event.entry : e)),
        );
        return;
      }

      case "ledger.status.changed": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.ledger.update((l) => (l ? { ...l, status: event.status } : l));
        // Do not clear activeAgents here: the main solver keeps running
        // between a `verified` ledger and the final `submit_final_answer`
        // call. The paired `agent.activity` finished events take care of
        // tearing the indicator down once the loop actually settles.
        return;
      }

      case "ledger.normalized_problem.set": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.ledger.update((l) =>
          l ? { ...l, normalizedProblem: event.normalizedProblem } : l,
        );
        return;
      }

      case "ledger.final_answer.set": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.ledger.update((l) =>
          l ? { ...l, finalAnswer: event.finalAnswer } : l,
        );
        return;
      }

      case "ledger.narrative.set": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.ledger.update((l) =>
          l ? { ...l, narrative: event.narrative } : l,
        );
        return;
      }

      case "conversation.message.added": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.messages.update((list) => {
          if (list.some((m) => m._id === event.message._id)) return list;
          return [...list, event.message];
        });
        return;
      }

      case "conversation.status.changed": {
        this.patchConversationLocal(event.conversationId, { status: event.status });
        return;
      }

      case "solver.error": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.solverError.set({
          conversationId: event.conversationId,
          code: event.error.code,
          message: event.error.message,
          ts: new Date().toISOString(),
        });
        // The main solver loop still settles after a solver.error and its
        // `trackAgentActivity` finally block will clear the indicator.
        return;
      }

      case "usage.updated": {
        // Keep the conversation list doc in sync regardless of selection so
        // the aggregate is correct when the user switches back to it.
        this.patchConversationLocal(event.conversationId, { usage: event.usage });
        if (!this.matchesSelected(event.conversationId)) return;
        this.usage.set(event.usage);
        return;
      }

      case "agent.activity": {
        if (!this.matchesSelected(event.conversationId)) return;
        this.activeAgents.update((list) => {
          if (event.status === "started") {
            if (list.includes(event.tool)) return list;
            return [...list, event.tool];
          }
          if (!list.includes(event.tool)) return list;
          return list.filter((t) => t !== event.tool);
        });
        return;
      }

      default: {
        // Exhaustive switch; ignore unknowns at runtime.
        const _exhaustive: never = event;
        void _exhaustive;
        return;
      }
    }
  }

  private matchesSelected(conversationId: string): boolean {
    return this.selectedConversationId() === conversationId;
  }

  private patchConversationLocal(id: string, patch: Partial<Conversation>): void {
    this.conversations.update((list) =>
      list.map((c) => (c._id === id ? { ...c, ...patch } : c)),
    );
  }

  private formatError(err: unknown): string {
    if (err && typeof err === "object" && "message" in err) {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string") return msg;
    }
    return "Request failed.";
  }
}

// Re-export for templates.
export type { ConversationStatus };
