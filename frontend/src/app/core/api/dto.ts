/**
 * Mirror of `backend/src/db/types.ts`. Kept as plain interfaces so the
 * frontend remains decoupled from the backend module while being
 * type-aligned with the wire format.
 */

export type ConversationStatus =
  | "active"
  | "paused"
  | "solved"
  | "failed"
  | "archived";

export type ConversationRole = "user" | "assistant" | "system";

/**
 * How much reasoning effort the solver should spend per turn. `high` is the
 * deep / careful default; `fast` shaves one tier off every agent in the
 * pipeline.
 */
export type ReasoningSpeed = "high" | "fast";

export const DEFAULT_REASONING_SPEED: ReasoningSpeed = "high";

/**
 * Optional, opt-in extra tools the solver may use for a conversation. Absent /
 * `false` means the base pipeline (symbolic + numerical) only.
 */
export interface AdditionalTools {
  /** Calabi-Yau Analyst sub-agent (CYTools-backed) available to the solver. */
  cyAnalyst?: boolean;
  /** Reference Seeker sub-agent (web-search-backed) available to the solver. */
  referenceSeeker?: boolean;
}

export interface Conversation {
  _id: string;
  userId: string;
  problemId: string;
  ledgerId: string;
  title: string;
  status: ConversationStatus;
  reasoningSpeed?: ReasoningSpeed;
  /** Per-conversation opt-in extra tools (e.g. the Calabi-Yau Analyst). */
  additionalTools?: AdditionalTools;
  /** Running token/cost aggregate across every LLM call for this conversation. */
  usage?: ConversationUsage;
  createdAt: string;
  updatedAt: string;
}

/** Logical agent role an LLM call is attributed to. */
export type UsageAgentRole =
  | "main_solver"
  | "full_verification"
  | "step_verification"
  | "computation"
  | "cy_analyst"
  | "reference_seeker"
  | "proof_narrator"
  | "side_talk";

export interface UsageTokens {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface ConversationUsage extends UsageTokens {
  costUsd: number;
  calls: number;
}

export interface UsageBreakdownRow {
  role: UsageAgentRole;
  model: string;
  tokens: UsageTokens;
  costUsd: number;
  calls: number;
}

export interface ConversationMessage {
  _id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  relatedEntries: string[];
  createdAt: string;
}

export interface SideTalkEntryRef {
  entryId: string;
  entryType: LedgerEntryType;
  summary: string;
}

export interface SideTalkArtifactRef {
  fileId: string;
  entryId: string;
  name: string;
  mimeType: string;
}

export interface SideTalkMessage {
  _id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  loadedEntries?: SideTalkEntryRef[];
  loadedArtifacts?: SideTalkArtifactRef[];
  createdAt: string;
}

export type LedgerStatus = "active" | "paused" | "solved" | "failed" | "verified";

export interface Ledger {
  _id: string;
  problemId: string;
  conversationId: string;
  status: LedgerStatus;
  problemStatement: string;
  normalizedProblem?: string;
  finalAnswer?: string;
  /** Markdown walkthrough of the successful reasoning chain (proof narrator). */
  narrative?: string;
  createdAt: string;
  updatedAt: string;
}

export type LedgerEntryType =
  | "assumption"
  | "derivation"
  | "result"
  | "symbolic_computation"
  | "numerical_computation"
  | "cy_analyst_computation"
  | "reference_lookup"
  | "verification"
  | "correction"
  | "final_answer"
  | "problem_followup";

export type LedgerEntryStatus = "pending" | "accepted" | "rejected" | "superseded";

export type LedgerEntryTool =
  | "main_solver"
  | "ledger"
  | "symbolic"
  | "numerical"
  | "cy_analyst"
  | "reference_seeker"
  | "step_verification"
  | "full_verification"
  | "user";

/** Subset of `LedgerEntryTool` that corresponds to actual reasoning agents. */
export type AgentTool =
  | "main_solver"
  | "symbolic"
  | "numerical"
  | "cy_analyst"
  | "reference_seeker"
  | "step_verification"
  | "full_verification"
  | "proof_narrator";

export interface LedgerEntryArtifact {
  /** Id of the persisted file in the generatedFiles collection. */
  fileId?: string;
  name: string;
  mimeType: string;
  size: number;
  skipped?: boolean;
  reason?: string;
}

export interface LedgerEntryContent {
  summary: string;
  details?: Record<string, unknown>;
  verdict?: "accepted" | "rejected" | "verified";
  justification?: string;
  finalAnswer?: string;
}

export interface LedgerEntryArtifacts {
  code?: string;
  stdout?: string;
  stderr?: string;
  files?: LedgerEntryArtifact[];
  durationMs?: number;
  openaiResponseIds?: string[];
}

export interface LedgerEntry {
  _id: string;
  ledgerId: string;
  type: LedgerEntryType;
  status: LedgerEntryStatus;
  dependsOn: string[];
  content: LedgerEntryContent;
  tool: LedgerEntryTool;
  artifacts?: LedgerEntryArtifacts;
  /**
   * Reasoning speed under which the entry was produced. Used by the UI to
   * tag fast-mode entries; not exposed back to the models.
   */
  reasoningSpeed?: ReasoningSpeed;
  createdAt: string;
  updatedAt?: string;
}

// --- Wire wrapper shapes -----------------------------------------------

export interface ListConversationsResponse {
  conversations: Conversation[];
}

export interface CreateConversationResponse {
  conversationId: string;
  ledgerId: string;
  problemId: string;
}

export interface ConversationResponse {
  conversation: Conversation;
}

export interface MessagesResponse {
  messages: ConversationMessage[];
}

export interface MessageResponse {
  message: ConversationMessage;
}

export interface LedgerResponse {
  ledger: Ledger;
}

export interface EntriesResponse {
  entries: LedgerEntry[];
}

export interface UsageResponse {
  usage: ConversationUsage;
  breakdown: UsageBreakdownRow[];
}

export interface SideTalkMessagesResponse {
  messages: SideTalkMessage[];
}

export interface SideTalkReplyResponse {
  userMessage: SideTalkMessage;
  assistantMessage: SideTalkMessage;
}

// --- SSE event payloads ------------------------------------------------

export type SolverEvent =
  | {
      type: "ready";
      conversationId: string;
      ledgerId: string;
      activeAgents: AgentTool[];
    }
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
    }
  | { type: "heartbeat"; ts: number };

export type SolverEventName = SolverEvent["type"];
