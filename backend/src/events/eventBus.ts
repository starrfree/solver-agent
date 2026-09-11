import { EventEmitter } from "node:events";

import {
  ConversationMessage,
  ConversationStatus,
  ConversationUsage,
  LedgerEntry,
  LedgerStatus,
} from "../db/types";

/**
 * Subset of `LedgerEntryTool` that corresponds to actual reasoning agents.
 * Used by `agent.activity` events so the UI can show which agent is
 * currently working without inspecting the ledger.
 */
export type AgentTool =
  | "main_solver"
  | "symbolic"
  | "numerical"
  | "cy_analyst"
  | "reference_seeker"
  | "step_verification"
  | "full_verification"
  | "proof_narrator";

export type SolverEvent =
  | {
      type: "ledger.entry.added";
      ledgerId: string;
      conversationId: string;
      entry: LedgerEntry;
    }
  | {
      type: "ledger.entry.updated";
      ledgerId: string;
      conversationId: string;
      entry: LedgerEntry;
    }
  | {
      type: "ledger.status.changed";
      ledgerId: string;
      conversationId: string;
      status: LedgerStatus;
    }
  | {
      type: "ledger.normalized_problem.set";
      ledgerId: string;
      conversationId: string;
      normalizedProblem: string;
    }
  | {
      type: "ledger.final_answer.set";
      ledgerId: string;
      conversationId: string;
      finalAnswer: string;
    }
  | {
      type: "ledger.narrative.set";
      ledgerId: string;
      conversationId: string;
      narrative: string;
    }
  | {
      type: "conversation.message.added";
      ledgerId: string;
      conversationId: string;
      message: ConversationMessage;
    }
  | {
      type: "conversation.status.changed";
      ledgerId: string;
      conversationId: string;
      status: ConversationStatus;
    }
  | {
      type: "solver.error";
      ledgerId: string;
      conversationId: string;
      error: { code: string; message: string };
    }
  | {
      type: "agent.activity";
      ledgerId: string;
      conversationId: string;
      tool: AgentTool;
      status: "started" | "finished";
    }
  | {
      type: "usage.updated";
      ledgerId: string;
      conversationId: string;
      usage: ConversationUsage;
    };

export type SolverEventListener = (event: SolverEvent) => void;

class SolverEventBus {
  private readonly emitter = new EventEmitter();
  /**
   * Snapshot of agents currently working per conversation. Mutated by
   * `trackAgentActivity` and read on SSE connect so a (re)connecting
   * client can hydrate its UI without waiting for the next event.
   */
  private readonly active = new Map<string, Set<AgentTool>>();

  constructor() {
    // SSE subscribers are unbounded by design; suppress maxListeners warnings.
    this.emitter.setMaxListeners(0);
  }

  /** Returns the agents currently flagged as working for `conversationId`. */
  activeAgents(conversationId: string): AgentTool[] {
    const set = this.active.get(conversationId);
    return set ? [...set] : [];
  }

  markAgentStarted(conversationId: string, tool: AgentTool): void {
    let set = this.active.get(conversationId);
    if (!set) {
      set = new Set<AgentTool>();
      this.active.set(conversationId, set);
    }
    set.add(tool);
  }

  markAgentFinished(conversationId: string, tool: AgentTool): void {
    const set = this.active.get(conversationId);
    if (!set) return;
    set.delete(tool);
    if (set.size === 0) this.active.delete(conversationId);
  }

  /**
   * Listen to events scoped to a single conversation/ledger pair.
   * Returns an unsubscribe function.
   */
  subscribe(conversationId: string, listener: SolverEventListener): () => void {
    const channel = this.channel(conversationId);
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Listen to every event regardless of conversation. Mostly useful for
   * structured logging.
   */
  subscribeAll(listener: SolverEventListener): () => void {
    this.emitter.on("*", listener);
    return () => {
      this.emitter.off("*", listener);
    };
  }

  emit(event: SolverEvent): void {
    this.emitter.emit(this.channel(event.conversationId), event);
    this.emitter.emit("*", event);
  }

  private channel(conversationId: string): string {
    return `conv:${conversationId}`;
  }
}

export const eventBus = new SolverEventBus();

/**
 * Wrap an async operation with paired `agent.activity` events. The start
 * event is emitted before the body runs, the finish event after it
 * settles (success or error), so the UI can mirror live agent activity.
 */
export async function trackAgentActivity<T>(
  args: { ledgerId: string; conversationId: string; tool: AgentTool },
  body: () => Promise<T>,
): Promise<T> {
  eventBus.markAgentStarted(args.conversationId, args.tool);
  eventBus.emit({
    type: "agent.activity",
    ledgerId: args.ledgerId,
    conversationId: args.conversationId,
    tool: args.tool,
    status: "started",
  });
  try {
    return await body();
  } finally {
    eventBus.markAgentFinished(args.conversationId, args.tool);
    eventBus.emit({
      type: "agent.activity",
      ledgerId: args.ledgerId,
      conversationId: args.conversationId,
      tool: args.tool,
      status: "finished",
    });
  }
}
