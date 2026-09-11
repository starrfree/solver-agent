/**
 * Human-readable labels shared by the Markdown and LaTeX renderers. Kept
 * exhaustive over the domain unions so adding an entry type, tool or role
 * without a label is a compile error.
 */
import type {
  LedgerEntryStatus,
  LedgerEntryTool,
  LedgerEntryType,
  UsageAgentRole,
} from "../db/types";

export const TYPE_LABELS: Record<LedgerEntryType, string> = {
  assumption: "Assumption",
  derivation: "Derivation",
  result: "Result",
  symbolic_computation: "Symbolic computation",
  numerical_computation: "Numerical computation",
  cy_analyst_computation: "Calabi-Yau computation",
  reference_lookup: "Reference lookup",
  verification: "Verification",
  correction: "Correction",
  final_answer: "Final answer",
  problem_followup: "Follow-up",
};

export const TOOL_LABELS: Record<LedgerEntryTool, string> = {
  main_solver: "Main solver",
  ledger: "Ledger",
  symbolic: "Symbolic agent",
  numerical: "Numerical agent",
  cy_analyst: "Calabi-Yau Analyst",
  reference_seeker: "Reference Seeker",
  step_verification: "Step verifier",
  full_verification: "Full-solution verifier",
  user: "User",
};

export const STATUS_LABELS: Record<LedgerEntryStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  superseded: "Superseded",
};

export const ROLE_LABELS: Record<UsageAgentRole, string> = {
  main_solver: "Main solver",
  full_verification: "Full-solution verifier",
  step_verification: "Step verifier",
  computation: "Symbolic / numerical agents",
  cy_analyst: "Calabi-Yau Analyst",
  reference_seeker: "Reference Seeker",
  proof_narrator: "Proof narrator",
  side_talk: "Side-talk",
};

/** Usage role whose model produced entries attributed to a given tool. */
export const TOOL_TO_ROLE: Record<LedgerEntryTool, UsageAgentRole | null> = {
  main_solver: "main_solver",
  ledger: "main_solver",
  symbolic: "computation",
  numerical: "computation",
  cy_analyst: "cy_analyst",
  reference_seeker: "reference_seeker",
  step_verification: "step_verification",
  full_verification: "full_verification",
  user: null,
};

export const COMPUTATION_TYPES: ReadonlySet<LedgerEntryType> = new Set<LedgerEntryType>([
  "symbolic_computation",
  "numerical_computation",
  "cy_analyst_computation",
  "reference_lookup",
]);

export function isComputationType(type: LedgerEntryType): boolean {
  return COMPUTATION_TYPES.has(type);
}

export function isRasterImage(mimeType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(mimeType);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m} min ${rest} s`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
