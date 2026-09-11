import type { ResponseInputItem } from "openai/resources/responses/responses";

import { env } from "../config/env";
import { Ledger, LedgerEntry } from "../db/types";
import { fetchArtifactFileHandler } from "../tools/fetchArtifactFileTool";
import type { ToolContext } from "../tools/types";
import { logger } from "../util/logger";
import {
  createResponse,
  effortFor,
  extractAssistantText,
  findFinalMessage,
  findFunctionCalls,
} from "./llmClient";
import { PROOF_NARRATOR_PROMPT } from "./systemPrompts";
import { proofNarratorTools } from "./toolSchemas";

export interface RunProofNarratorInput {
  ledger: Ledger;
  entries: LedgerEntry[];
  conversationId: string;
  finalAnswer: string;
}

/**
 * Turn the verified ledger into a faithful Markdown walkthrough of the
 * successful reasoning chain. The agent has only `fetch_artifact_file`, so it
 * can inspect generated files but cannot run any computation — it can only
 * narrate what the ledger already contains. Returns the walkthrough Markdown,
 * or an empty string if the model produced nothing usable.
 */
export async function runProofNarratorAgent(
  input: RunProofNarratorInput,
  parentCtx: ToolContext,
): Promise<string> {
  const inputItems: ResponseInputItem[] = [
    { type: "message", role: "user", content: buildPrompt(input) },
  ];

  for (let turn = 0; turn < env.SUB_AGENT_MAX_TURNS; turn += 1) {
    if (parentCtx.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const response = await createResponse({
      reasoningSpeed: parentCtx.reasoningSpeed,
      reasoningRole: "proof_narrator",
      instructions: PROOF_NARRATOR_PROMPT,
      input: inputItems,
      tools: proofNarratorTools,
      reasoning: {
        effort: effortFor(parentCtx.reasoningSpeed, "proof_narrator"),
        summary: "auto",
      },
      store: true,
      promptCacheKey: `proof-narrator:${input.ledger._id}`,
      parallelToolCalls: false,
      ...(parentCtx.signal ? { signal: parentCtx.signal } : {}),
    });

    for (const item of response.output) {
      if (
        item.type === "reasoning" ||
        item.type === "function_call" ||
        item.type === "message"
      ) {
        inputItems.push(item as ResponseInputItem);
      }
    }

    const calls = findFunctionCalls(response);
    if (calls.length === 0) {
      const final = findFinalMessage(response);
      return final ? extractAssistantText(final) : "";
    }

    const pendingExtraInputItems: ResponseInputItem[] = [];
    for (const call of calls) {
      const out =
        call.name === "fetch_artifact_file"
          ? await fetchArtifactFileHandler(parentCtx, call)
          : JSON.stringify({ ok: false, error: `Unknown tool '${call.name}'.` });
      inputItems.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: out,
      });
      if (parentCtx.extraInputItems.length > 0) {
        for (const extra of parentCtx.extraInputItems) {
          pendingExtraInputItems.push(extra);
        }
        parentCtx.extraInputItems.length = 0;
      }
    }
    if (pendingExtraInputItems.length > 0) {
      inputItems.push(...pendingExtraInputItems);
    }
  }

  logger.warn(
    { ledgerId: input.ledger._id },
    "Proof narrator exhausted max turns without producing a walkthrough",
  );
  return "";
}

function buildPrompt(input: RunProofNarratorInput): string {
  const lines: string[] = [];
  lines.push(`Conversation id: ${input.conversationId}`);
  lines.push(
    `Generated files for this conversation are served at /api/conversations/${input.conversationId}/files/<fileId>. Use this exact path when embedding images.`,
  );
  lines.push("");
  lines.push("Problem statement:");
  lines.push(input.ledger.problemStatement);
  if (input.ledger.normalizedProblem) {
    lines.push("");
    lines.push("Normalized problem:");
    lines.push(input.ledger.normalizedProblem);
  }
  lines.push("");
  lines.push("Verified final answer:");
  lines.push(input.finalAnswer);
  lines.push("");
  const followupCount = input.entries.filter((e) => e.type === "problem_followup").length;
  if (followupCount > 0) {
    lines.push(
      `This conversation has ${followupCount} user follow-up(s) recorded as 'problem_followup' entries. Your walkthrough must be self-contained from the original problem through every follow-up to the verified final answer — not only the work after the latest follow-up.`,
    );
    lines.push("");
  }
  lines.push(
    `Complete ledger (${input.entries.length} entries, in chronological order). Narrate the full successful chain from the original problem onward — skip entries whose status is 'superseded' or 'rejected':`,
  );
  for (const e of input.entries) {
    lines.push(formatEntry(e, input.conversationId));
  }
  return lines.join("\n");
}

const MAX_CODE_CHARS = 4000;
const MAX_STDOUT_CHARS = 2000;

function formatEntry(entry: LedgerEntry, conversationId: string): string {
  const parts: string[] = [];
  const dep = entry.dependsOn.length > 0 ? entry.dependsOn.join(", ") : "(none)";
  parts.push(
    `- [${entry._id}] type=${entry.type} status=${entry.status} tool=${entry.tool} dependsOn=[${dep}]`,
  );
  parts.push(`  summary: ${entry.content.summary}`);
  if (entry.type === "problem_followup") {
    const body = entry.content.details?.body;
    if (typeof body === "string" && body.trim()) {
      parts.push(`  user follow-up (full text):\n${body.trim()}`);
    }
  } else if (entry.content.details && Object.keys(entry.content.details).length > 0) {
    parts.push(`  details: ${JSON.stringify(entry.content.details)}`);
  }
  if (entry.content.verdict) {
    parts.push(`  verdict: ${entry.content.verdict}`);
  }
  if (entry.content.justification) {
    parts.push(`  justification: ${entry.content.justification}`);
  }
  const artifacts = entry.artifacts;
  if (artifacts) {
    if (artifacts.code) {
      parts.push(`  code:\n${truncate(artifacts.code, MAX_CODE_CHARS)}`);
    }
    if (artifacts.stdout) {
      parts.push(`  stdout:\n${truncate(artifacts.stdout, MAX_STDOUT_CHARS)}`);
    }
    if (artifacts.files && artifacts.files.length > 0) {
      const files = artifacts.files
        .filter((f) => f.fileId && !f.skipped)
        .map(
          (f) =>
            `${f.name} (${f.mimeType}) -> /api/conversations/${conversationId}/files/${f.fileId}`,
        );
      if (files.length > 0) {
        parts.push(`  files: ${files.join("; ")}`);
      }
    }
  }
  return parts.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [truncated]`;
}
