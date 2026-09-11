/**
 * Renderer-independent document model for a conversation export.
 *
 * `buildExport` turns the persisted conversation / ledger / files / usage into
 * an `ExportDocument`; `renderHtml` and `renderLatex` serialise it without
 * touching the database. Keeping the model separate makes the renderers pure
 * and testable against fixtures.
 */
import type {
  LedgerEntryStatus,
  LedgerEntryTool,
  LedgerEntryType,
  LedgerStatus,
  ReasoningSpeed,
  UsageAgentRole,
} from "../db/types";

export interface ExportModelRow {
  role: UsageAgentRole;
  model: string;
  calls: number;
}

export interface ExportPromptRef {
  /** Constant name in `systemPrompts.ts`, e.g. `MAIN_SOLVER_PROMPT`. */
  name: string;
  /** Human label used as the heading in the System Prompts section. */
  label: string;
  /** Hex SHA-256 of the exact prompt text. */
  sha256: string;
  /** Exact prompt text. */
  text: string;
}

export interface ExportHeader {
  title: string;
  conversationId: string;
  ledgerId: string;
  /** ISO timestamp of the export. */
  exportedAt: string;
  /** ISO timestamp of the conversation's creation. */
  createdAt: string;
  ledgerStatus: LedgerStatus;
  reasoningSpeed: ReasoningSpeed;
  /** Human labels of the opt-in tools that were enabled. */
  enabledTools: string[];
  /** Models actually used, per agent role (from the usage records). */
  models: ExportModelRow[];
  /** SHA-256 over the concatenation of every included prompt's hash. */
  promptsSha256: string;
  solverAgentVersion: string;
}

export interface ExportPrompt {
  /** 0 = original problem statement, 1.. = follow-ups. */
  index: number;
  createdAt: string;
  /** Raw user text (Markdown with math). */
  content: string;
}

export interface ExportMessage {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  /** Raw Markdown with math, exactly as typed / generated. */
  content: string;
  /** Ledger entry ids this message refers to (e.g. the final answer). */
  relatedEntries: string[];
}

export interface ExportFile {
  /** Id of the persisted file (absent when skipped). */
  fileId?: string;
  /** File name as produced by the sandbox. */
  name: string;
  /** Path inside the bundle, e.g. `artifacts/ledg_x/figure-1.png`. */
  path: string;
  mimeType: string;
  size: number;
  /** Raster image that renderers may embed inline. */
  isImage: boolean;
  /** Not persisted (over the size cap); `path` is absent in that case. */
  skipped: boolean;
  reason?: string;
}

export interface ExportComputation {
  task?: string;
  status?: string;
  result?: string;
  error?: string;
  code?: string;
  /** Path of the code file inside the bundle, e.g. `code/ledg_x.py`. */
  codePath?: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  files: ExportFile[];
}

export interface ExportVerificationIssue {
  entryId: string;
  problem: string;
  requiredCorrection: string;
}

export interface ExportVerification {
  verdict?: string;
  method?: string;
  justification?: string;
  counterExample?: string;
  focus?: string;
  targetEntryId?: string;
  candidateAnswer?: string;
  issues?: ExportVerificationIssue[];
}

export interface ExportEntry {
  id: string;
  type: LedgerEntryType;
  tool: LedgerEntryTool;
  status: LedgerEntryStatus;
  reasoningSpeed?: ReasoningSpeed;
  createdAt: string;
  dependsOn: string[];
  summary: string;
  /** Markdown/LaTeX body written by the solver (assumptions, derivations, ...). */
  body?: string;
  /** Models used by the agent role that produced this entry. */
  models: string[];
  computation?: ExportComputation;
  verification?: ExportVerification;
  finalAnswer?: string;
  /** Any `content.details` keys not covered by the fields above. */
  extraDetails?: Record<string, unknown>;
}

export interface ExportDocument {
  header: ExportHeader;
  prompts: ExportPrompt[];
  entries: ExportEntry[];
  systemPrompts: ExportPromptRef[];
  /**
   * Full chat transcript (user and assistant turns, oldest first). Only
   * `report.html` shows it; `report.tex` presents the prompts and
   * the ledger.
   */
  messages: ExportMessage[];
}

/** A file to place in the bundle alongside the rendered documents. */
export interface ExportBinary {
  path: string;
  data: Buffer;
}

export interface ExportBundle {
  document: ExportDocument;
  /** Machine-readable dump of the raw records (serialised to `ledger.json`). */
  ledgerJson: unknown;
  binaries: ExportBinary[];
  /** Suggested zip file name. */
  fileName: string;
}
