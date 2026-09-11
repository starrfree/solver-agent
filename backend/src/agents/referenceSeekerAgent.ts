import type { ResponseInputItem } from "openai/resources/responses/responses";

import { env } from "../config/env";
import { ReasoningSpeed } from "../db/types";
import { logger } from "../util/logger";
import {
  createResponse,
  effortFor,
  extractAssistantText,
  findFinalMessage,
} from "./llmClient";
import type { ComputationResult } from "./symbolicAgent";
import { REFERENCE_SEEKER_AGENT_PROMPT } from "./systemPrompts";
import { referenceSeekerResultSchema } from "./toolSchemas";

/**
 * Run the Reference Seeker sub-agent: an LLM loop equipped only with OpenAI's
 * hosted `web_search` tool. It is given something to look up on the live web
 * and returns either the relevant content with its sources or an explicit
 * "not found" — it never invents references (see
 * {@link REFERENCE_SEEKER_AGENT_PROMPT}).
 *
 * The hosted tool runs server-side, so the model can search, read results and
 * search again within a single response; the outer loop only exists as a
 * safety net in case a response ends without a final message.
 *
 * Returns the shared {@link ComputationResult} shape (with empty
 * code/stdout/artifacts) so the computation handler / ledger persistence
 * machinery is reused unchanged.
 */
export async function runReferenceSeekerAgent(input: {
  task: string;
  context?: string;
  reasoningSpeed: ReasoningSpeed;
  signal?: AbortSignal;
}): Promise<ComputationResult> {
  const initialMessage = input.context
    ? `What to look for:\n${input.task}\n\nContext (ledger entries this lookup depends on):\n${input.context}`
    : `What to look for:\n${input.task}`;

  const inputItems: ResponseInputItem[] = [
    { type: "message", role: "user", content: initialMessage },
  ];
  const openaiResponseIds: string[] = [];

  for (let turn = 0; turn < env.SUB_AGENT_MAX_TURNS; turn += 1) {
    if (input.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    const response = await createResponse({
      reasoningSpeed: input.reasoningSpeed,
      reasoningRole: "reference_seeker",
      instructions: REFERENCE_SEEKER_AGENT_PROMPT,
      input: inputItems,
      webSearch: true,
      reasoning: {
        effort: effortFor(input.reasoningSpeed, "reference_seeker"),
        summary: "auto",
      },
      responseFormat: referenceSeekerResultSchema,
      store: true,
      promptCacheKey: "reference-seeker-agent",
      parallelToolCalls: false,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    openaiResponseIds.push(response.id);

    for (const item of response.output) {
      if (
        item.type === "reasoning" ||
        item.type === "message" ||
        // Hosted web_search runs server-side; re-feed its call items so any
        // reasoning that references them stays valid across turns.
        item.type === "web_search_call"
      ) {
        inputItems.push(item as ResponseInputItem);
      }
    }

    const final = findFinalMessage(response);
    if (final) {
      const parsed = parseStructuredOutput(extractAssistantText(final));
      return { ...parsed, openaiResponseIds };
    }
  }

  logger.warn(
    { task: input.task },
    "Reference Seeker sub-agent exhausted max turns without producing a result",
  );
  return {
    status: "error",
    result: "",
    summary: "Reference Seeker exhausted its turn budget.",
    code: "",
    error: `Sub-agent exceeded ${env.SUB_AGENT_MAX_TURNS} turns without producing a final answer.`,
    stdout: "",
    stderr: "",
    artifacts: [],
    openaiResponseIds,
  };
}

interface ParsedReferenceSeekerOutput {
  status: "success" | "error";
  found: boolean;
  result: string;
  summary: string;
  error: string | null;
}

function parseStructuredOutput(
  text: string,
): Omit<ComputationResult, "openaiResponseIds"> {
  const empty = { code: "", stdout: "", stderr: "", artifacts: [] };
  if (!text.trim()) {
    return {
      status: "error",
      result: "",
      summary: "Reference Seeker returned an empty message.",
      error: "empty_response",
      ...empty,
    };
  }
  try {
    const obj = JSON.parse(text) as Partial<ParsedReferenceSeekerOutput>;
    return {
      status: obj.status === "success" ? "success" : "error",
      result: typeof obj.result === "string" ? obj.result : "",
      summary: typeof obj.summary === "string" ? obj.summary : "",
      error: typeof obj.error === "string" ? obj.error : null,
      ...empty,
    };
  } catch (err) {
    return {
      status: "error",
      result: "",
      summary: "Reference Seeker produced unparsable structured output.",
      error: `parse_error: ${(err as Error).message}`,
      ...empty,
    };
  }
}
