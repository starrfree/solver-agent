import { Injectable, signal } from "@angular/core";

import { SolverEvent, SolverEventName } from "./dto";

const EVENT_NAMES: SolverEventName[] = [
  "ready",
  "ledger.entry.added",
  "ledger.entry.updated",
  "ledger.status.changed",
  "ledger.normalized_problem.set",
  "ledger.final_answer.set",
  "ledger.narrative.set",
  "conversation.message.added",
  "conversation.status.changed",
  "solver.error",
  "agent.activity",
  "usage.updated",
  "heartbeat",
];

export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 15_000;

@Injectable({ providedIn: "root" })
export class StreamService {
  /** Public, reactive status of the underlying EventSource. */
  readonly status = signal<StreamStatus>("idle");
  /** Number of consecutive reconnects since the last successful open. */
  readonly retryCount = signal(0);
  /** ISO timestamp of the last received event. */
  readonly lastEventAt = signal<string | null>(null);

  private source: EventSource | null = null;
  private currentConversationId: string | null = null;
  private currentHandler: ((event: SolverEvent) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;

  /**
   * Connect (or reconnect) to the SSE stream for `conversationId`. Replaces
   * any existing connection. The handler is invoked for every parsed event
   * including heartbeats; consumers may filter by `event.type`.
   */
  connect(conversationId: string, handler: (event: SolverEvent) => void): void {
    this.disconnect();
    this.currentConversationId = conversationId;
    this.currentHandler = handler;
    this.manualClose = false;
    this.retryCount.set(0);
    this.openSource();
  }

  /** Tear down the current connection, if any. Safe to call repeatedly. */
  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.currentConversationId = null;
    this.currentHandler = null;
    this.status.set("idle");
  }

  private openSource(): void {
    if (!this.currentConversationId) return;

    const url = `/api/conversations/${encodeURIComponent(this.currentConversationId)}/stream`;
    this.status.set(this.retryCount() === 0 ? "connecting" : "reconnecting");

    let source: EventSource;
    try {
      source = new EventSource(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.source = source;

    source.addEventListener("open", () => {
      this.retryCount.set(0);
      this.status.set("open");
    });

    source.addEventListener("error", () => {
      // EventSource auto-retries, but only on the same URL with no jitter; we
      // close it and schedule our own backoff so reconnections after server
      // restarts behave predictably.
      if (this.manualClose) return;
      source.close();
      if (this.source === source) this.source = null;
      this.scheduleReconnect();
    });

    for (const name of EVENT_NAMES) {
      source.addEventListener(name, (raw: MessageEvent<string>) => {
        if (!this.currentHandler) return;
        let parsed: SolverEvent;
        try {
          parsed = JSON.parse(raw.data) as SolverEvent;
        } catch {
          return;
        }
        this.lastEventAt.set(new Date().toISOString());
        this.currentHandler(parsed);
      });
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose || !this.currentConversationId) return;
    const next = this.retryCount() + 1;
    this.retryCount.set(next);
    this.status.set("reconnecting");
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * Math.pow(2, next - 1),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSource();
    }, delay);
  }
}
