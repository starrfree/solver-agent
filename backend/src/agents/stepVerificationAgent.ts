import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";

import { env } from "../config/env";
import { LedgerEntry } from "../db/types";
import { fetchArtifactFileHandler } from "../tools/fetchArtifactFileTool";
import type { ToolContext } from "../tools/types";
import { logger } from "../util/logger";
import { runCyAnalystAgent } from "./cyAnalystAgent";
import { runNumericalAgent } from "./numericalAgent";
import { runReferenceSeekerAgent } from "./referenceSeekerAgent";
import {
  createResponse,
  effortFor,
  extractAssistantText,
  findFinalMessage,
  findFunctionCalls,
  isAbort,
  isMissingPreviousResponseError,
  providerFor,
} from "./llmClient";
import { runSymbolicAgent } from "./symbolicAgent";
import { STEP_VERIFICATION_PROMPT } from "./systemPrompts";
import { buildVerificationSubAgentTools, stepVerificationSchema } from "./toolSchemas";

export interface StepVerdict {
  verdict: "accepted" | "rejected";
  justification: string;
  method: string;
  counterExample: string | null;
  openaiResponseIds: string[];
}

export interface RunStepVerificationInput {
  target: LedgerEntry;
  dependencies: LedgerEntry[];
  focus: string;
}

export async function runStepVerificationAgent(
  input: RunStepVerificationInput,
  parentCtx: ToolContext,
): Promise<StepVerdict> {
  const initial = buildPrompt(input);
  const tools = buildVerificationSubAgentTools({
    cyAnalyst: parentCtx.conversation.additionalTools?.cyAnalyst ?? false,
    referenceSeeker:
      parentCtx.conversation.additionalTools?.referenceSeeker ?? false,
  });

  // OpenAI keeps chained turns server-side via previous_response_id, so we
  // only send the new function_call_output items each turn. The Claude /
  // HuggingFace back-ends merely emulate that chaining with an in-process
  // cache that can be evicted (restart, TTL, capacity) — and they re-send the
  // full history over the wire anyway — so for them we carry the input array
  // ourselves (manual state, same pattern as the full-verification agent).
  const useServerState =
    providerFor(parentCtx.reasoningSpeed, "step_verification") === "openai";

  const inputItems: ResponseInputItem[] = [
    { type: "message", role: "user", content: initial } as ResponseInputItem,
  ];
  let nextInput: string | ResponseInputItem[] = initial;
  let previousResponseId: string | undefined;
  const openaiResponseIds: string[] = [];
  let restarts = 0;
  let turn = 0;

  while (turn < env.SUB_AGENT_MAX_TURNS) {
    turn += 1;
    if (parentCtx.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    let response;
    try {
      response = await createResponse({
        reasoningSpeed: parentCtx.reasoningSpeed,
        reasoningRole: "step_verification",
        instructions: STEP_VERIFICATION_PROMPT,
        input: useServerState ? nextInput : inputItems,
        tools,
        reasoning: {
          effort: effortFor(parentCtx.reasoningSpeed, "step_verification"),
          summary: "auto",
        },
        responseFormat: stepVerificationSchema,
        ...(useServerState && previousResponseId ? { previousResponseId } : {}),
        store: true,
        promptCacheKey: "step-verification-agent",
        parallelToolCalls: false,
        ...(parentCtx.signal ? { signal: parentCtx.signal } : {}),
      });
    } catch (err) {
      // Safety net: a broken previous_response_id chain (expired, evicted, or
      // lost across a restart) is recoverable because the verification task is
      // stateless — restart once from the initial input instead of recording a
      // spurious rejection.
      if (
        useServerState &&
        previousResponseId !== undefined &&
        restarts < 1 &&
        isMissingPreviousResponseError(err)
      ) {
        restarts += 1;
        turn = 0;
        previousResponseId = undefined;
        nextInput = initial;
        logger.warn(
          { entryId: input.target._id, err },
          "Step verification lost its previous response; restarting the sub-agent from the initial input",
        );
        continue;
      }
      throw err;
    }
    openaiResponseIds.push(response.id);
    previousResponseId = response.id;

    if (!useServerState) {
      for (const item of response.output) {
        if (
          item.type === "reasoning" ||
          item.type === "function_call" ||
          item.type === "message"
        ) {
          inputItems.push(item as ResponseInputItem);
        }
      }
    }

    const calls = findFunctionCalls(response);
    if (calls.length === 0) {
      const final = findFinalMessage(response);
      const parsed = parseVerdict(final ? extractAssistantText(final) : "");
      return { ...parsed, openaiResponseIds };
    }

    const followUp: ResponseInputItem[] = [];
    const pendingExtraInputItems: ResponseInputItem[] = [];
    for (const call of calls) {
      const out = await dispatchVerificationTool(call, parentCtx);
      followUp.push(toFunctionCallOutput(call.call_id, out));
      if (parentCtx.extraInputItems.length > 0) {
        for (const extra of parentCtx.extraInputItems) {
          pendingExtraInputItems.push(extra);
        }
        parentCtx.extraInputItems.length = 0;
      }
    }
    if (pendingExtraInputItems.length > 0) {
      followUp.push(...pendingExtraInputItems);
    }
    if (useServerState) {
      nextInput = followUp;
    } else {
      inputItems.push(...followUp);
    }
  }

  logger.warn(
    { entryId: input.target._id },
    "Step verification sub-agent exhausted max turns",
  );
  return {
    verdict: "rejected",
    justification: `Sub-agent exhausted its turn budget (${env.SUB_AGENT_MAX_TURNS} turns) without reaching a verdict.`,
    method: "n/a",
    counterExample: null,
    openaiResponseIds,
  };
}

function buildPrompt(input: RunStepVerificationInput): string {
  const lines: string[] = [];
  lines.push("Target ledger entry to verify:");
  lines.push(formatEntry(input.target));
  if (input.dependencies.length > 0) {
    lines.push("");
    lines.push("Declared dependencies (in order):");
    for (const dep of input.dependencies) {
      lines.push(formatEntry(dep));
    }
  }
  lines.push("");
  lines.push(`Focus from the Main Solver Agent: ${input.focus}`);
  return lines.join("\n");
}

function formatEntry(entry: LedgerEntry): string {
  const detailsStr =
    entry.content.details && Object.keys(entry.content.details).length > 0
      ? `\n  details: ${JSON.stringify(entry.content.details)}`
      : "";
  const dep = entry.dependsOn.length > 0 ? entry.dependsOn.join(", ") : "(none)";
  return [
    `- id: ${entry._id}`,
    `  type: ${entry.type}`,
    `  status: ${entry.status}`,
    `  tool: ${entry.tool}`,
    `  dependsOn: ${dep}`,
    `  summary: ${entry.content.summary}`,
    detailsStr,
  ]
    .filter(Boolean)
    .join("\n");
}

interface SubAgentToolArgs {
  task: string;
}

export async function dispatchVerificationTool(
  call: ResponseFunctionToolCall,
  parentCtx: ToolContext,
): Promise<string> {
  if (call.name === "fetch_artifact_file") {
    return fetchArtifactFileHandler(parentCtx, call);
  }

  let args: SubAgentToolArgs;
  try {
    args = JSON.parse(call.arguments) as SubAgentToolArgs;
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: `Invalid JSON in tool arguments: ${(err as Error).message}`,
    });
  }
  if (!args.task) {
    return JSON.stringify({ ok: false, error: "Field 'task' is required." });
  }

  try {
    if (call.name === "symbolic_compute") {
      const r = await runSymbolicAgent({
        task: args.task,
        reasoningSpeed: parentCtx.reasoningSpeed,
        ...(parentCtx.signal ? { signal: parentCtx.signal } : {}),
      });
      return JSON.stringify({
        ok: r.status === "success",
        status: r.status,
        result: r.result,
        summary: r.summary,
        error: r.error,
      });
    }
    if (call.name === "numerical_compute") {
      const r = await runNumericalAgent({
        task: args.task,
        reasoningSpeed: parentCtx.reasoningSpeed,
        ...(parentCtx.signal ? { signal: parentCtx.signal } : {}),
      });
      return JSON.stringify({
        ok: r.status === "success",
        status: r.status,
        result: r.result,
        summary: r.summary,
        error: r.error,
      });
    }
    if (call.name === "cy_analyst_compute") {
      const r = await runCyAnalystAgent({
        task: args.task,
        reasoningSpeed: parentCtx.reasoningSpeed,
        ...(parentCtx.signal ? { signal: parentCtx.signal } : {}),
      });
      return JSON.stringify({
        ok: r.status === "success",
        status: r.status,
        result: r.result,
        summary: r.summary,
        error: r.error,
      });
    }
    if (call.name === "seek_references") {
      const r = await runReferenceSeekerAgent({
        task: args.task,
        reasoningSpeed: parentCtx.reasoningSpeed,
        ...(parentCtx.signal ? { signal: parentCtx.signal } : {}),
      });
      return JSON.stringify({
        ok: r.status === "success",
        status: r.status,
        result: r.result,
        summary: r.summary,
        error: r.error,
      });
    }
    return JSON.stringify({
      ok: false,
      error: `Unknown tool '${call.name}'.`,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function toFunctionCallOutput(call_id: string, output: string) {
  return { type: "function_call_output" as const, call_id, output };
}

function parseVerdict(text: string): Omit<StepVerdict, "openaiResponseIds"> {
  if (!text.trim()) {
    return {
      verdict: "rejected",
      justification: "Sub-agent returned an empty verdict.",
      method: "n/a",
      counterExample: null,
    };
  }
  try {
    const obj = JSON.parse(text) as Partial<StepVerdict>;
    return {
      verdict: obj.verdict === "accepted" ? "accepted" : "rejected",
      justification: typeof obj.justification === "string" ? obj.justification : "",
      method: typeof obj.method === "string" ? obj.method : "",
      counterExample: typeof obj.counterExample === "string" ? obj.counterExample : null,
    };
  } catch (err) {
    return {
      verdict: "rejected",
      justification: `Sub-agent produced unparsable verdict: ${(err as Error).message}`,
      method: "n/a",
      counterExample: null,
    };
  }
}
