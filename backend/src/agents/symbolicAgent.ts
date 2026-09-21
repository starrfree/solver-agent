import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";

import { env } from "../config/env";
import { ReasoningSpeed } from "../db/types";
import { runPython, RunnerArtifact } from "../python/runner";
import { TimeoutError } from "../util/errors";
import { logger } from "../util/logger";
import {
  createResponse,
  effortFor,
  extractAssistantText,
  findFinalMessage,
  findFunctionCalls,
  isMissingPreviousResponseError,
  providerFor,
} from "./llmClient";
import type { ReasoningRole } from "./openaiClient";
import { SYMBOLIC_AGENT_PROMPT } from "./systemPrompts";
import { computationSubAgentResultSchema, computationSubAgentTools } from "./toolSchemas";

export interface ComputationResult {
  status: "success" | "timeout" | "error";
  result: string;
  summary: string;
  code: string;
  error: string | null;
  /** Aggregated stdout from the runner. */
  stdout: string;
  /** Aggregated stderr from the runner. */
  stderr: string;
  /** Files captured from the sandbox. */
  artifacts: RunnerArtifact[];
  /** Wall-clock duration of the last successful Python run, when applicable. */
  durationMs?: number;
  /** OpenAI response IDs the sub-agent produced. */
  openaiResponseIds: string[];
}

interface RunPythonArgs {
  code: string;
  purpose: string;
}

interface RunSymbolicAgentInput {
  task: string;
  /** Concatenated ledger context (entries this computation depends on). */
  context?: string;
  /** Reasoning speed inherited from the parent solver run. */
  reasoningSpeed: ReasoningSpeed;
  /** Optional abort signal forwarded from the orchestrator. */
  signal?: AbortSignal;
}

const SYMBOLIC_OUTPUT_FORMAT = computationSubAgentResultSchema;

export async function runSymbolicAgent(
  input: RunSymbolicAgentInput,
): Promise<ComputationResult> {
  return runComputationSubAgent({
    instructions: SYMBOLIC_AGENT_PROMPT,
    promptCacheKey: "symbolic-agent",
    task: input.task,
    context: input.context,
    reasoningSpeed: input.reasoningSpeed,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

interface RunComputationSubAgentOptions {
  instructions: string;
  promptCacheKey: string;
  task: string;
  context?: string;
  reasoningSpeed: ReasoningSpeed;
  signal?: AbortSignal;
  /**
   * Override for the per-run_python wall-clock cap. When omitted the runner
   * falls back to env.PYTHON_TIMEOUT_MS (halved in 'fast' mode). The numerical
   * sub-agent passes a larger budget so heavy C++ search has room to finish.
   */
  pythonTimeoutMs?: number;
  /**
   * LLM reasoning role used to resolve model / effort for this sub-agent.
   * Defaults to "computation" (shared by symbolic + numerical); the CY Analyst
   * passes "cy_analyst" so it can be tuned / cost-tracked independently.
   */
  reasoningRole?: ReasoningRole;
}

export async function runComputationSubAgent(
  options: RunComputationSubAgentOptions,
): Promise<ComputationResult> {
  const initialMessage = options.context
    ? `Task:\n${options.task}\n\nContext (ledger entries this depends on):\n${options.context}`
    : `Task:\n${options.task}`;

  const reasoningRole: ReasoningRole = options.reasoningRole ?? "computation";

  // OpenAI keeps chained turns server-side via previous_response_id; the
  // Claude / HuggingFace / Gemini back-ends only emulate that with an
  // evictable in-process cache (and re-send the full history anyway), so for
  // them we carry the input array ourselves (manual state).
  const useServerState = providerFor(options.reasoningSpeed, reasoningRole) === "openai";

  const inputItems: ResponseInputItem[] = [
    { type: "message", role: "user", content: initialMessage } as ResponseInputItem,
  ];
  let nextInput: string | ResponseInputItem[] = initialMessage;
  let previousResponseId: string | undefined;
  const openaiResponseIds: string[] = [];
  let restarts = 0;
  let turn = 0;

  // Per-sub-agent rolling state (last successful run captured here).
  const aggregate = {
    stdout: "",
    stderr: "",
    artifacts: [] as RunnerArtifact[],
    durationMs: undefined as number | undefined,
    code: "",
    timeouts: 0,
  };

  while (turn < env.SUB_AGENT_MAX_TURNS) {
    turn += 1;
    if (options.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    let response;
    try {
      response = await createResponse({
        reasoningSpeed: options.reasoningSpeed,
        reasoningRole,
        instructions: options.instructions,
        input: useServerState ? nextInput : inputItems,
        tools: computationSubAgentTools,
        reasoning: {
          effort: effortFor(options.reasoningSpeed, reasoningRole),
          summary: "auto",
        },
        responseFormat: SYMBOLIC_OUTPUT_FORMAT,
        ...(useServerState && previousResponseId ? { previousResponseId } : {}),
        store: true,
        promptCacheKey: options.promptCacheKey,
        parallelToolCalls: false,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      // Safety net: a broken previous_response_id chain (expired, evicted, or
      // lost across a restart) is recoverable because the task is stateless —
      // restart once from the initial input instead of failing the tool call.
      if (
        useServerState &&
        previousResponseId !== undefined &&
        restarts < 1 &&
        isMissingPreviousResponseError(err)
      ) {
        restarts += 1;
        turn = 0;
        previousResponseId = undefined;
        nextInput = initialMessage;
        logger.warn(
          { task: options.task, err },
          "Computation sub-agent lost its previous response; restarting from the initial input",
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
      const parsed = parseStructuredOutput(final ? extractAssistantText(final) : "");
      return {
        status: parsed.status,
        result: parsed.result,
        summary: parsed.summary,
        code: parsed.code || aggregate.code,
        error: parsed.error,
        stdout: aggregate.stdout,
        stderr: aggregate.stderr,
        artifacts: aggregate.artifacts,
        ...(aggregate.durationMs !== undefined ? { durationMs: aggregate.durationMs } : {}),
        openaiResponseIds,
      };
    }

    const followUp: ResponseInputItem[] = [];
    for (const call of calls) {
      const out = await dispatchSubAgentTool(
        call,
        aggregate,
        options.reasoningSpeed,
        options.pythonTimeoutMs,
      );
      followUp.push(toFunctionCallOutput(call.call_id, out));
    }
    if (useServerState) {
      nextInput = followUp;
    } else {
      inputItems.push(...followUp);
    }
  }

  logger.warn(
    { task: options.task },
    "Computation sub-agent exhausted max turns without producing a verdict",
  );

  return {
    status: "error",
    result: "",
    summary: "Sub-agent exhausted its turn budget.",
    code: aggregate.code,
    error: `Sub-agent exceeded ${env.SUB_AGENT_MAX_TURNS} turns without producing a final answer.`,
    stdout: aggregate.stdout,
    stderr: aggregate.stderr,
    artifacts: aggregate.artifacts,
    openaiResponseIds,
  };
}

interface AggregateState {
  stdout: string;
  stderr: string;
  artifacts: RunnerArtifact[];
  durationMs?: number;
  code: string;
  timeouts: number;
}

async function dispatchSubAgentTool(
  call: ResponseFunctionToolCall,
  state: AggregateState,
  reasoningSpeed: ReasoningSpeed,
  pythonTimeoutMs?: number,
): Promise<string> {
  if (call.name !== "run_python") {
    return JSON.stringify({
      ok: false,
      error: `Unknown tool '${call.name}'. The only available tool is run_python.`,
    });
  }

  let args: RunPythonArgs;
  try {
    args = JSON.parse(call.arguments) as RunPythonArgs;
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: `Invalid JSON in tool arguments: ${(err as Error).message}`,
    });
  }
  if (!args.code) {
    return JSON.stringify({ ok: false, error: "Field 'code' is required." });
  }

  state.code = args.code;
  try {
    const baseTimeoutMs = pythonTimeoutMs ?? env.PYTHON_TIMEOUT_MS;
    const timeoutMs =
      reasoningSpeed === "fast"
        ? Math.max(1, Math.floor(baseTimeoutMs / 2))
        : Math.max(1, Math.floor(baseTimeoutMs));
    const r = await runPython({ code: args.code, timeoutMs });
    state.stdout = r.stdout;
    state.stderr = r.stderr;
    state.artifacts = r.artifacts;
    state.durationMs = r.durationMs;
    return JSON.stringify({
      ok: true,
      exitCode: r.exitCode,
      stdout: truncate(r.stdout, 16_000),
      stderr: truncate(r.stderr, 16_000),
      durationMs: r.durationMs,
      artifacts: r.artifacts.map((a) => ({
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
        skipped: a.skipped ?? false,
      })),
    });
  } catch (err) {
    if (err instanceof TimeoutError) {
      state.timeouts += 1;
      const exhausted = state.timeouts >= env.PYTHON_MAX_TIMEOUTS;
      return JSON.stringify({
        ok: false,
        error: "timeout",
        timeoutMs: err.timeoutMs,
        timeoutsSoFar: state.timeouts,
        exhausted,
        hint: exhausted
          ? "Timeout budget exhausted. Return status 'timeout' in your final structured output."
          : "Decompose the computation into smaller sub-tasks and try again with a different approach.",
      });
    }
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function toFunctionCallOutput(call_id: string, output: string) {
  return {
    type: "function_call_output" as const,
    call_id,
    output,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

interface ParsedComputationOutput {
  status: ComputationResult["status"];
  result: string;
  summary: string;
  code: string;
  error: string | null;
}

function parseStructuredOutput(text: string): ParsedComputationOutput {
  if (!text.trim()) {
    return {
      status: "error",
      result: "",
      summary: "Sub-agent returned an empty message.",
      code: "",
      error: "empty_response",
    };
  }
  try {
    const obj = JSON.parse(text) as Partial<ParsedComputationOutput>;
    return {
      status:
        obj.status === "success" || obj.status === "timeout" || obj.status === "error"
          ? obj.status
          : "error",
      result: typeof obj.result === "string" ? obj.result : "",
      summary: typeof obj.summary === "string" ? obj.summary : "",
      code: typeof obj.code === "string" ? obj.code : "",
      error: typeof obj.error === "string" ? obj.error : null,
    };
  } catch (err) {
    return {
      status: "error",
      result: "",
      summary: "Sub-agent produced unparsable structured output.",
      code: "",
      error: `parse_error: ${(err as Error).message}`,
    };
  }
}
