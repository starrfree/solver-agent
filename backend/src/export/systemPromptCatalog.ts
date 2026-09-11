import { createHash } from "node:crypto";

import {
  CY_ANALYST_AGENT_PROMPT,
  FULL_VERIFICATION_PROMPT,
  MAIN_SOLVER_CY_ANALYST_NOTE,
  MAIN_SOLVER_PROMPT,
  MAIN_SOLVER_REFERENCE_SEEKER_NOTE,
  NUMERICAL_AGENT_PROMPT,
  REFERENCE_SEEKER_AGENT_PROMPT,
  STEP_VERIFICATION_PROMPT,
  SYMBOLIC_AGENT_PROMPT,
} from "../agents/systemPrompts";
import type { AdditionalTools } from "../db/types";
import type { ExportPromptRef } from "./types";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function ref(name: string, label: string, text: string): ExportPromptRef {
  return { name, label, sha256: sha256(text), text };
}

/**
 * The system prompts that governed a conversation, in the order the agents
 * appear in the pipeline. Opt-in tool prompts (and the notes appended to the
 * Main solver's prompt when they are on) are included only when the
 * conversation had them enabled, so the export reflects what the models
 * actually saw. Side-talk and the Proof Narrator are not part of the ledger
 * and are left out.
 */
export function collectSystemPrompts(tools: AdditionalTools | undefined): ExportPromptRef[] {
  const cy = tools?.cyAnalyst === true;
  const refs = tools?.referenceSeeker === true;

  const out: ExportPromptRef[] = [
    ref("MAIN_SOLVER_PROMPT", "Main solver", MAIN_SOLVER_PROMPT),
  ];
  if (cy) {
    out.push(
      ref(
        "MAIN_SOLVER_CY_ANALYST_NOTE",
        "Main solver: Calabi-Yau Analyst note (appended when enabled)",
        MAIN_SOLVER_CY_ANALYST_NOTE,
      ),
    );
  }
  if (refs) {
    out.push(
      ref(
        "MAIN_SOLVER_REFERENCE_SEEKER_NOTE",
        "Main solver: Reference Seeker note (appended when enabled)",
        MAIN_SOLVER_REFERENCE_SEEKER_NOTE,
      ),
    );
  }
  out.push(
    ref("SYMBOLIC_AGENT_PROMPT", "Symbolic computation agent", SYMBOLIC_AGENT_PROMPT),
    ref("NUMERICAL_AGENT_PROMPT", "Numerical computation agent", NUMERICAL_AGENT_PROMPT),
  );
  if (cy) {
    out.push(ref("CY_ANALYST_AGENT_PROMPT", "Calabi-Yau Analyst agent", CY_ANALYST_AGENT_PROMPT));
  }
  if (refs) {
    out.push(
      ref("REFERENCE_SEEKER_AGENT_PROMPT", "Reference Seeker agent", REFERENCE_SEEKER_AGENT_PROMPT),
    );
  }
  out.push(
    ref("STEP_VERIFICATION_PROMPT", "Step verifier", STEP_VERIFICATION_PROMPT),
    ref("FULL_VERIFICATION_PROMPT", "Full-solution verifier", FULL_VERIFICATION_PROMPT),
  );
  return out;
}

/** One hash over all included prompts, in order, for the header. */
export function combinedPromptHash(prompts: ExportPromptRef[]): string {
  return sha256(prompts.map((p) => `${p.name}:${p.sha256}`).join("\n"));
}
