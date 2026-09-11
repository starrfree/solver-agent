/**
 * Domain types for the MongoDB collections (conversations, ledgers, entries,
 * generated files, side-talk, usage).
 *
 * IDs are stored as strings (UUIDv4) so they can be used both as MongoDB
 * `_id` values and freely passed through the OpenAI tool boundary without
 * forcing the model to round-trip BSON ObjectIds.
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
 * pipeline (main solver and full verification drop from high to medium,
 * step verification and computation sub-agents drop from medium to low).
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
  /** Per-conversation reasoning speed. Defaults to `high` when absent. */
  reasoningSpeed?: ReasoningSpeed;
  /** Per-conversation opt-in extra tools (e.g. the Calabi-Yau Analyst). */
  additionalTools?: AdditionalTools;
  /** Running token/cost aggregate across every LLM call for this conversation. */
  usage?: ConversationUsage;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Logical agent role an LLM call is attributed to. Mirrors `ReasoningRole`
 * in `agents/openaiClient.ts`; duplicated here to keep the db layer free of
 * an agents-layer import.
 */
export type UsageAgentRole =
  | "main_solver"
  | "full_verification"
  | "step_verification"
  | "computation"
  | "cy_analyst"
  | "reference_seeker"
  | "proof_narrator"
  | "side_talk";

/** Token counts for a single call or an aggregate. */
export interface UsageTokens {
  inputTokens: number;
  /** Subset of `inputTokens` served from the prompt cache. */
  cachedInputTokens: number;
  outputTokens: number;
  /** Subset of `outputTokens` spent on internal reasoning. */
  reasoningTokens: number;
  totalTokens: number;
}

/** Running per-conversation aggregate maintained with `$inc`. */
export interface ConversationUsage extends UsageTokens {
  costUsd: number;
  /** Number of LLM calls folded into this aggregate. */
  calls: number;
}

/**
 * Append-only record of a single LLM call's usage and cost. One document per
 * `createResponse` invocation that resolves within an active usage context.
 */
export interface UsageRecord {
  _id: string;
  conversationId: string;
  ledgerId: string;
  provider: string;
  model: string;
  role: UsageAgentRole;
  tokens: UsageTokens;
  costUsd: number;
  createdAt: Date;
}

export interface ConversationMessage {
  _id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  /** Ledger entry IDs referenced by this message (e.g. final_answer entry). */
  relatedEntries: string[];
  createdAt: Date;
}

/**
 * A ledger entry the side-talk model pulled into context via
 * `get_ledger_entries`. Persisted on the assistant turn so the UI can show a
 * flag that scrolls to the entry in the conversation timeline.
 */
export interface SideTalkEntryRef {
  entryId: string;
  entryType: LedgerEntryType;
  summary: string;
}

/**
 * A generated file the side-talk model loaded via `fetch_artifact_file`.
 * Persisted on the assistant turn so the UI can show a flag that opens the
 * owning entry in the artifacts panel.
 */
export interface SideTalkArtifactRef {
  fileId: string;
  /** Entry that produced the file — used to open the artifacts panel. */
  entryId: string;
  name: string;
  mimeType: string;
}

/**
 * A "side-talk" turn: an off-the-record question/answer about the ongoing
 * work. Side-talk never touches the ledger or the solver orchestrator and is
 * stored in its own collection so it stays out of the solver's input.
 */
export interface SideTalkMessage {
  _id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  /** Ledger entries this answer pulled into context (assistant turns only). */
  loadedEntries?: SideTalkEntryRef[];
  /** Generated files this answer inspected (assistant turns only). */
  loadedArtifacts?: SideTalkArtifactRef[];
  createdAt: Date;
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
  /**
   * Markdown walkthrough of the successful reasoning chain, produced by the
   * Proof Narrator agent after the solution is verified and submitted.
   * Surfaced read-only in the UI; never fed back to the solver.
   */
  narrative?: string;
  createdAt: Date;
  updatedAt: Date;
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

/**
 * Reference to a file persisted in the `generatedFiles` collection. The
 * ledger only ever stores this lightweight reference; the bytes live in
 * a dedicated collection and are served through the HTTP files endpoint.
 */
export interface LedgerEntryArtifact {
  /** Id of the persisted GeneratedFile. Omitted only when `skipped` is true. */
  fileId?: string;
  /** File name as produced by the Python sandbox (e.g. `figure-1.png`). */
  name: string;
  /** RFC 6838 mime type guessed from the extension. */
  mimeType: string;
  /** Size in bytes (always present). */
  size: number;
  /** Whether the artifact was retained or skipped due to size limits. */
  skipped?: boolean;
  /** Reason a file was skipped, when applicable. */
  reason?: string;
}

/**
 * Bytes of a file produced by the Python sandbox. Stored in its own
 * collection so the ledger entries stay small and the bytes can be
 * served / streamed without dragging the surrounding metadata along.
 */
export interface GeneratedFile {
  _id: string;
  ledgerId: string;
  conversationId: string;
  entryId: string;
  name: string;
  mimeType: string;
  size: number;
  /** Raw bytes (BSON binary). */
  data: Buffer;
  createdAt: Date;
}

/** Free-form structured payload for an entry. Validated per-`type` at call sites. */
export interface LedgerEntryContent {
  /** One-line summary used by UI cards and prompt compaction. */
  summary: string;
  /** Optional detailed body (LaTeX, prose, structured fields). */
  details?: Record<string, unknown>;
  /** Verdict for verification entries. */
  verdict?: "accepted" | "rejected" | "verified";
  /** Free-form justification text. */
  justification?: string;
  /** For final_answer entries. */
  finalAnswer?: string;
}

export interface LedgerEntryArtifacts {
  /** Generated source code (Python, etc.). */
  code?: string;
  /** stdout captured from the runner. */
  stdout?: string;
  /** stderr / error trace. */
  stderr?: string;
  /** Files produced by the sandbox. */
  files?: LedgerEntryArtifact[];
  /** Wall-clock duration in milliseconds. */
  durationMs?: number;
  /** OpenAI response IDs produced by sub-agents while resolving this entry. */
  openaiResponseIds?: string[];
}

export interface LedgerEntry {
  _id: string;
  ledgerId: string;
  type: LedgerEntryType;
  status: LedgerEntryStatus;
  /** Previous entry IDs this step depends on. */
  dependsOn: string[];
  content: LedgerEntryContent;
  tool: LedgerEntryTool;
  artifacts?: LedgerEntryArtifacts;
  /**
   * Reasoning speed under which the entry was produced. Stored for
   * frontend display only — never surfaced back to the models, so the
   * solver can't condition its behavior on past speed choices.
   */
  reasoningSpeed?: ReasoningSpeed;
  createdAt: Date;
  /** Set when an in-place mutation occurred (only allowed for status flips). */
  updatedAt?: Date;
}
