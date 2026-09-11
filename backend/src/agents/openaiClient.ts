import OpenAI from "openai";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
  Tool,
  WebSearchTool,
} from "openai/resources/responses/responses";
import type { Reasoning } from "openai/resources/shared";

import { env } from "../config/env";
import type { ReasoningSpeed } from "../db/types";
import { logger } from "../util/logger";

export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY || "sk-placeholder" });

/**
 * Canonical reasoning-effort axis from the OpenAI SDK, plus `"max"` which
 * z.ai GLM exposes via the HuggingFace router. Claude maps both `xhigh`
 * and `max` to its native adaptive-thinking levels in `claudeClient`.
 */
export type ReasoningEffort = NonNullable<Reasoning["effort"]> | "max";

/**
 * Logical "role" of an agent for the purposes of picking a reasoning
 * effort. Each role gets its own column in {@link EFFORT_MATRIX} so we can
 * dial them independently while exposing a single `reasoningSpeed` knob to
 * the user.
 */
export type ReasoningRole =
  | "main_solver"
  | "full_verification"
  | "step_verification"
  | "computation"
  | "cy_analyst"
  | "reference_seeker"
  | "proof_narrator"
  | "side_talk";

export interface JsonSchemaResponseFormat {
  name: string;
  schema: Record<string, unknown>;
  description?: string;
  strict?: boolean;
}

/** Reasoning config accepted by all provider back-ends (effort includes vendor extensions). */
export interface SolverReasoning {
  effort?: ReasoningEffort;
  summary?: Reasoning["summary"];
  /** OpenAI Responses API only — ignored by Claude / HuggingFace. */
  generate_summary?: Reasoning["generate_summary"];
}

export interface CreateResponseOptions {
  /**
   * Concrete model id resolved by the provider-aware `llmClient` dispatcher
   * from the `(reasoningSpeed, reasoningRole)` lookup. Required by both the
   * OpenAI and Claude back-ends.
   */
  model: string;
  /** Reasoning speed used by the dispatcher to select model + provider. */
  reasoningSpeed?: ReasoningSpeed;
  /** Logical role used by the dispatcher to select model + provider. */
  reasoningRole?: ReasoningRole;
  /** System / developer instructions for this turn. */
  instructions?: string;
  /** Either a string user message or a fully-formed input array. */
  input: string | ResponseInputItem[];
  /** Function tools the model can call this turn. */
  tools?: FunctionTool[];
  /**
   * Enable OpenAI's hosted `web_search` tool for this turn so the model can
   * query the live internet. Runs server-side and is appended alongside any
   * function `tools`. OpenAI-only — ignored by the Claude back-end.
   */
  webSearch?: boolean;
  /** Reasoning configuration. */
  reasoning?: SolverReasoning;
  /** Constrain the final assistant message with a JSON schema. */
  responseFormat?: JsonSchemaResponseFormat;
  /** Use OpenAI-managed conversation state. */
  previousResponseId?: string;
  /** Whether OpenAI should persist this response (needed for previous_response_id). */
  store?: boolean;
  /** Stable cache key, e.g. the conversation id. */
  promptCacheKey?: string;
  /** Tool choice override. */
  toolChoice?: ResponseCreateParamsNonStreaming["tool_choice"];
  /** Cap output tokens (visible + reasoning). */
  maxOutputTokens?: number;
  /** Allow parallel function calls. */
  parallelToolCalls?: boolean;
  /**
   * Abort signal forwarded to the underlying HTTP request. When fired,
   * the in-flight Responses API call is cancelled and `createResponse`
   * rejects with an `APIUserAbortError` (subclass of `Error` with
   * `name === "AbortError"`). Used by the solver orchestrator to make
   * `pause` interrupt long-running model calls quickly.
   */
  signal?: AbortSignal;
}

const DEFAULT_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** OpenAI Responses API does not accept vendor-only `max`; map to `xhigh`. */
function toOpenAiReasoning(reasoning: SolverReasoning): Reasoning {
  const effort =
    reasoning.effort === "max" ? "xhigh" : (reasoning.effort as Reasoning["effort"]);
  return {
    ...(reasoning.summary !== undefined ? { summary: reasoning.summary } : {}),
    ...(reasoning.generate_summary !== undefined
      ? { generate_summary: reasoning.generate_summary }
      : {}),
    ...(effort !== undefined ? { effort } : {}),
  };
}

/** Single Responses API call with retry on transient failures. */
export async function createResponse(
  options: CreateResponseOptions,
): Promise<Response> {
  // Combine function tools with the hosted web_search tool when requested.
  // `web_search` is the GA hosted tool (the legacy `web_search_preview` does
  // not support filters / newer controls). The model decides whether to call
  // it; with other tools present, search stays optional (tool_choice auto).
  const tools: Tool[] = [
    ...(options.tools ?? []),
    ...(options.webSearch
      ? [{ type: "web_search", search_context_size: "medium" } satisfies WebSearchTool]
      : []),
  ];

  const body: ResponseCreateParamsNonStreaming = {
    model: options.model,
    input: options.input,
    ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(options.reasoning ? { reasoning: toOpenAiReasoning(options.reasoning) } : {}),
    ...(options.responseFormat
      ? {
          text: {
            format: {
              type: "json_schema",
              name: options.responseFormat.name,
              schema: options.responseFormat.schema,
              strict: options.responseFormat.strict ?? true,
              ...(options.responseFormat.description
                ? { description: options.responseFormat.description }
                : {}),
            },
          },
        }
      : {}),
    ...(options.previousResponseId
      ? { previous_response_id: options.previousResponseId }
      : {}),
    ...(typeof options.store === "boolean" ? { store: options.store } : {}),
    ...(options.promptCacheKey ? { prompt_cache_key: options.promptCacheKey } : {}),
    ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
    ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
    ...(typeof options.parallelToolCalls === "boolean"
      ? { parallel_tool_calls: options.parallelToolCalls }
      : {}),
  };

  const requestOptions = options.signal ? { signal: options.signal } : undefined;

  let attempt = 0;
  let lastError: unknown;
  while (attempt < DEFAULT_RETRIES) {
    attempt += 1;
    if (options.signal?.aborted) {
      throw new AbortError("Aborted before Responses API call");
    }
    try {
      const response = await openai.responses.create(body, requestOptions);
      return response as Response;
    } catch (err) {
      lastError = err;
      if (isAbort(err)) throw err;
      const status = (err as { status?: number }).status;
      const isRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);
      if (!isRetryable || attempt >= DEFAULT_RETRIES) {
        throw err;
      }
      const delayMs = 250 * Math.pow(2, attempt - 1);
      logger.warn(
        { attempt, status, delayMs },
        "Responses API call failed, retrying",
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

/**
 * Sentinel thrown by `createResponse` when the caller's `AbortSignal`
 * fires before the request is dispatched. Propagated through the agent
 * loop so the orchestrator can distinguish a user-initiated pause from
 * a real failure.
 */
export class AbortError extends Error {
  override name = "AbortError";
}

export function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "AbortError" || name === "APIUserAbortError";
}

// --- Output item helpers --------------------------------------------------

export function isFunctionCall(
  item: ResponseOutputItem,
): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

export function isReasoning(
  item: ResponseOutputItem,
): item is ResponseReasoningItem {
  return item.type === "reasoning";
}

export function isMessage(
  item: ResponseOutputItem,
): item is ResponseOutputMessage {
  return item.type === "message";
}

export function extractAssistantText(message: ResponseOutputMessage): string {
  return message.content
    .map((part) => {
      if (part.type === "output_text") return part.text;
      if (part.type === "refusal") return `[refusal] ${part.refusal}`;
      return "";
    })
    .join("");
}

/**
 * Find the final assistant message in a response. Returns null if the model
 * only emitted tool calls (the agent loop should call back into the model).
 */
export function findFinalMessage(
  response: Response,
): ResponseOutputMessage | null {
  for (let i = response.output.length - 1; i >= 0; i -= 1) {
    const item = response.output[i];
    if (item && isMessage(item)) return item;
  }
  return null;
}

export function findFunctionCalls(
  response: Response,
): ResponseFunctionToolCall[] {
  return response.output.filter(isFunctionCall);
}

// --- Generic agent loop ---------------------------------------------------

export interface AgentLoopHandlers {
  /**
   * Resolve a function_call. Implementations MUST return a string (the
   * `output` payload sent back to the model) and MUST NOT throw — wrap any
   * tool failure in a structured error string instead.
   */
  onToolCall: (call: ResponseFunctionToolCall) => Promise<string>;
  /** Called for each completed turn; useful for telemetry / persistence. */
  onTurn?: (response: Response) => void | Promise<void>;
}

export interface ManualLoopOptions extends Omit<CreateResponseOptions, "input"> {
  /** Initial conversation, will be appended to between turns. */
  input: ResponseInputItem[];
  /** Hard cap on the number of turns the loop may run. */
  maxTurns: number;
  handlers: AgentLoopHandlers;
}

export interface ManualLoopResult {
  finalMessage: ResponseOutputMessage | null;
  responses: Response[];
  /** The full input array as it stood at the end of the loop. */
  finalInput: ResponseInputItem[];
}

/**
 * Manual-state agent loop. After each turn, every `reasoning`,
 * `function_call`, and synthesized `function_call_output` item is appended
 * back to the next `input` in the order produced by the model. The loop
 * stops when the model emits a `message` item and no further function
 * calls in the same turn.
 */
export async function runManualAgentLoop(
  options: ManualLoopOptions,
): Promise<ManualLoopResult> {
  const { handlers, maxTurns, input: initialInput, ...createOptions } = options;
  const input: ResponseInputItem[] = [...initialInput];
  const responses: Response[] = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await createResponse({ ...createOptions, input });
    responses.push(response);
    if (handlers.onTurn) {
      await handlers.onTurn(response);
    }

    for (const item of response.output) {
      if (
        item.type === "reasoning" ||
        item.type === "function_call" ||
        item.type === "message"
      ) {
        input.push(item as ResponseInputItem);
      }
    }

    const calls = findFunctionCalls(response);
    if (calls.length === 0) {
      return { finalMessage: findFinalMessage(response), responses, finalInput: input };
    }

    for (const call of calls) {
      const output = await handlers.onToolCall(call);
      const resultItem: ResponseInputItem = {
        type: "function_call_output",
        call_id: call.call_id,
        output,
      };
      input.push(resultItem);
    }
  }

  throw new Error(`Agent loop exceeded ${maxTurns} turns without producing a final message`);
}

export interface PreviousResponseLoopOptions
  extends Omit<CreateResponseOptions, "input" | "previousResponseId"> {
  /** First user message that kicks off the sub-agent. */
  initialInput: string | ResponseInputItem[];
  maxTurns: number;
  handlers: AgentLoopHandlers;
}

export interface PreviousResponseLoopResult {
  finalMessage: ResponseOutputMessage | null;
  responses: Response[];
  /** The id of the last response, useful to chain another turn later. */
  finalResponseId: string | null;
}

/**
 * Sub-agent loop that uses `previous_response_id` for state. OpenAI keeps
 * the reasoning + tool-call history server side; we only have to feed back
 * `function_call_output` items between turns.
 */
export async function runPreviousResponseLoop(
  options: PreviousResponseLoopOptions,
): Promise<PreviousResponseLoopResult> {
  const { handlers, maxTurns, initialInput, ...createOptions } = options;

  let nextInput: string | ResponseInputItem[] = initialInput;
  let previousResponseId: string | undefined;
  const responses: Response[] = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await createResponse({
      ...createOptions,
      input: nextInput,
      ...(previousResponseId ? { previousResponseId } : {}),
      store: createOptions.store ?? true,
    });
    responses.push(response);
    if (handlers.onTurn) {
      await handlers.onTurn(response);
    }
    previousResponseId = response.id;

    const calls = findFunctionCalls(response);
    if (calls.length === 0) {
      return {
        finalMessage: findFinalMessage(response),
        responses,
        finalResponseId: response.id,
      };
    }

    const followUp: ResponseInputItem[] = [];
    for (const call of calls) {
      const output = await handlers.onToolCall(call);
      followUp.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
    }
    nextInput = followUp;
  }

  throw new Error(
    `Sub-agent loop exceeded ${maxTurns} turns without producing a final message`,
  );
}
