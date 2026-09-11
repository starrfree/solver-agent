import type { ResponseInputItem } from "openai/resources/responses/responses";

import { env } from "../config/env";
import { Ledger, LedgerEntry } from "../db/types";
import type { ToolContext } from "../tools/types";
import { logger } from "../util/logger";
import {
  createResponse,
  effortFor,
  extractAssistantText,
  findFinalMessage,
  findFunctionCalls,
} from "./llmClient";
import { dispatchVerificationTool } from "./stepVerificationAgent";
import { FULL_VERIFICATION_PROMPT } from "./systemPrompts";
import { buildVerificationSubAgentTools, fullVerificationSchema } from "./toolSchemas";

export interface FullVerdict {
  verdict: "verified" | "rejected";
  summary: string;
  issues: Array<{ entryId: string; problem: string; requiredCorrection: string }>;
  openaiResponseIds: string[];
}

export interface RunFullVerificationInput {
  ledger: Ledger;
  entries: LedgerEntry[];
  candidateAnswer: string;
}

export async function runFullVerificationAgent(
  input: RunFullVerificationInput,
  parentCtx: ToolContext,
): Promise<FullVerdict> {
  const initialMessage = buildPrompt(input);
  const tools = buildVerificationSubAgentTools({
    cyAnalyst: parentCtx.conversation.additionalTools?.cyAnalyst ?? false,
    referenceSeeker:
      parentCtx.conversation.additionalTools?.referenceSeeker ?? false,
  });
  const inputItems: ResponseInputItem[] = [
    { type: "message", role: "user", content: initialMessage },
  ];
  const openaiResponseIds: string[] = [];

  for (let turn = 0; turn < env.SUB_AGENT_MAX_TURNS; turn += 1) {
    if (parentCtx.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const response = await createResponse({
      reasoningSpeed: parentCtx.reasoningSpeed,
      reasoningRole: "full_verification",
      instructions: FULL_VERIFICATION_PROMPT,
      input: inputItems,
      tools,
      reasoning: {
        effort: effortFor(parentCtx.reasoningSpeed, "full_verification"),
        summary: "auto",
      },
      responseFormat: fullVerificationSchema,
      store: true,
      promptCacheKey: `full-verification:${input.ledger._id}`,
      parallelToolCalls: false,
      ...(parentCtx.signal ? { signal: parentCtx.signal } : {}),
    });
    openaiResponseIds.push(response.id);

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
      const parsed = parseVerdict(final ? extractAssistantText(final) : "");
      return { ...parsed, openaiResponseIds };
    }

    const pendingExtraInputItems: ResponseInputItem[] = [];
    for (const call of calls) {
      const out = await dispatchVerificationTool(call, parentCtx);
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
    "Full verification sub-agent exhausted max turns",
  );
  return {
    verdict: "rejected",
    summary: `Full verification sub-agent exceeded ${env.SUB_AGENT_MAX_TURNS} turns without producing a verdict.`,
    issues: [],
    openaiResponseIds,
  };
}

function buildPrompt(input: RunFullVerificationInput): string {
  const lines: string[] = [];
  lines.push("Problem statement:");
  lines.push(input.ledger.problemStatement);
  if (input.ledger.normalizedProblem) {
    lines.push("");
    lines.push("Normalized problem:");
    lines.push(input.ledger.normalizedProblem);
  }
  lines.push("");
  lines.push("Final answer candidate:");
  lines.push(input.candidateAnswer);
  lines.push("");
  lines.push(`Ledger (${input.entries.length} entries, in order):`);
  for (const e of input.entries) {
    lines.push(formatEntry(e));
  }
  return lines.join("\n");
}

function formatEntry(entry: LedgerEntry): string {
  const detailsStr =
    entry.content.details && Object.keys(entry.content.details).length > 0
      ? ` | details: ${JSON.stringify(entry.content.details)}`
      : "";
  const dep = entry.dependsOn.length > 0 ? entry.dependsOn.join(", ") : "(none)";
  return `[${entry._id}] type=${entry.type} status=${entry.status} tool=${entry.tool} dependsOn=[${dep}] :: ${entry.content.summary}${detailsStr}`;
}

function parseVerdict(text: string): Omit<FullVerdict, "openaiResponseIds"> {
  if (!text.trim()) {
    return {
      verdict: "rejected",
      summary: "Empty verdict from full verification sub-agent.",
      issues: [],
    };
  }
  try {
    const obj = JSON.parse(text) as Partial<FullVerdict>;
    return {
      verdict: obj.verdict === "verified" ? "verified" : "rejected",
      summary: typeof obj.summary === "string" ? obj.summary : "",
      issues: Array.isArray(obj.issues)
        ? obj.issues.map((i) => ({
            entryId: typeof i.entryId === "string" ? i.entryId : "",
            problem: typeof i.problem === "string" ? i.problem : "",
            requiredCorrection:
              typeof i.requiredCorrection === "string" ? i.requiredCorrection : "",
          }))
        : [],
    };
  } catch (err) {
    return {
      verdict: "rejected",
      summary: `Unparsable verdict: ${(err as Error).message}`,
      issues: [],
    };
  }
}
