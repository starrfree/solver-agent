/**
 * Provider-agnostic facade over the LLM client. Each `(reasoningSpeed,
 * reasoningRole)` pair is mapped to its own (provider, model, effort)
 * triple so individual agent stages can be hosted on different vendors —
 * e.g. main solver on Claude Sonnet 4.6 with the fast step-verifier on
 * `gpt-5.6-luna`.
 *
 * Callers always go through `createResponse` / `runManualAgentLoop` /
 * `runPreviousResponseLoop` exported from this module; they never import
 * the underlying `openaiClient`, `claudeClient`, `hfClient` or
 * `geminiClient` directly.
 */
import type { Response, ResponseInputItem } from "openai/resources/responses/responses";

import type { ReasoningSpeed } from "../db/types";

import * as claudeClient from "./claudeClient";
import * as geminiClient from "./geminiClient";
import * as hfClient from "./hfClient";
import * as openaiClient from "./openaiClient";
import { recordResponseUsageSafe } from "./usageTracker";
import type {
  AgentLoopHandlers,
  CreateResponseOptions,
  ManualLoopOptions,
  ManualLoopResult,
  PreviousResponseLoopOptions,
  PreviousResponseLoopResult,
  ReasoningEffort,
  ReasoningRole,
} from "./openaiClient";

// -------------------------------------------------------------------------
// Provider / model / effort matrices.
//
// Adjust freely: any agent stage can independently switch vendor or model
// without touching the call sites. `effort` uses the shared axis documented
// on {@link ReasoningEffort}; Claude maps it to adaptive-thinking levels.
// -------------------------------------------------------------------------

export type LlmProvider = "openai" | "claude" | "huggingface" | "gemini";

interface LlmTarget {
  provider: LlmProvider;
  model: string;
  effort: ReasoningEffort;
}

type Matrix<T> = Record<ReasoningSpeed, Record<ReasoningRole, T>>;

const PROVIDER_MATRIX: Matrix<LlmProvider> = {
  high: {
    // Default all-OpenAI high configuration:
    main_solver: "openai",
    full_verification: "openai",
    step_verification: "openai",
    computation: "openai",
    cy_analyst: "openai",
    proof_narrator: "openai",
    // main_solver: "claude",
    // full_verification: "claude",
    // step_verification: "claude",
    // computation: "claude",
    // cy_analyst: "claude",
    // Gemini high configuration:
    // main_solver: "gemini",
    // full_verification: "gemini",
    // step_verification: "gemini",
    // computation: "gemini",
    // cy_analyst: "gemini",
    // Must stay on OpenAI: the Reference Seeker relies on the hosted
    // web_search tool, which only the OpenAI back-end supports.
    reference_seeker: "openai",
    // proof_narrator: "claude",
    // proof_narrator: "gemini",
    // Stays on OpenAI: the side-talk UI can enable hosted web_search
    // per message, which only the OpenAI back-end supports.
    side_talk: "openai",
  },
  fast: {
    // Default all-OpenAI fast configuration:
    main_solver: "openai",
    full_verification: "openai",
    step_verification: "openai",
    computation: "openai",
    cy_analyst: "openai",
    // main_solver: "huggingface",
    // full_verification: "huggingface",
    // step_verification: "huggingface",
    // computation: "huggingface",
    // cy_analyst: "huggingface",
    // Gemini fast configuration:
    // main_solver: "gemini",
    // full_verification: "gemini",
    // step_verification: "gemini",
    // computation: "gemini",
    // cy_analyst: "gemini",
    // Must stay on OpenAI (hosted web_search).
    reference_seeker: "openai",
    proof_narrator: "openai",
    // proof_narrator: "huggingface",
    // proof_narrator: "gemini",
    // Stays on OpenAI (optional hosted web_search per message).
    side_talk: "openai",
  },
};

const MODEL_MATRIX: Matrix<string> = {
  high: {
    // Default all-OpenAI high configuration:
    main_solver: "gpt-5.6-sol",
    full_verification: "gpt-5.6-sol",
    step_verification: "gpt-5.6-sol",
    computation: "gpt-5.6-sol",
    cy_analyst: "gpt-5.6-sol",
    proof_narrator: "gpt-5.6-sol",
    //
    // Claude high configuration (list state Aug 2026): Fable 5 is Anthropic's
    // strongest reasoner (87.8% FrontierMath Tier 4) and drives the main
    // solver; Opus 5 — the flagship default at half Fable's price — covers
    // verification and computation; Sonnet 5 writes the walkthrough.
    // main_solver: "claude-fable-5",
    // full_verification: "claude-opus-5",
    // step_verification: "claude-opus-5",
    // computation: "claude-opus-5",
    // cy_analyst: "claude-opus-5",
    // proof_narrator: "claude-sonnet-5",
    //
    // Gemini high configuration (list state Sep 2026): Gemini 3.1 Pro is
    // Google's strongest reasoner and drives the main solver, the full
    // verifier and the CY analyst; Gemini 3.8 Flash (their most capable
    // Flash tier, built for long-horizon agentic work) covers step
    // verification, computation and narration at a fifth of Pro's price.
    // Both support structured output combined with function calling.
    // main_solver: "gemini-3.1-pro-preview",
    // full_verification: "gemini-3.1-pro-preview",
    // step_verification: "gemini-3.8-flash",
    // computation: "gemini-3.8-flash",
    // cy_analyst: "gemini-3.1-pro-preview",
    // proof_narrator: "gemini-3.8-flash",

    reference_seeker: "gpt-5.6-sol",
    side_talk: "gpt-5.6-sol",
  },
  fast: {
    // Default all-OpenAI fast configuration:
    main_solver: "gpt-5.6-luna",
    full_verification: "gpt-5.6-luna",
    step_verification: "gpt-5.6-luna",
    computation: "gpt-5.6-luna",
    cy_analyst: "gpt-5.6-luna",
    proof_narrator: "gpt-5.6-sol",
    //
    // HuggingFace router (:together) fast configuration (list state Aug
    // 2026): DeepSeek V4 Pro 0813 is the strongest open-weight reasoner and
    // solves; GLM-5.2 (~168 tok/s) cross-checks it from a different model
    // family; V4 Flash 0731 covers cheap agentic coding and narration at
    // $0.14/$0.28 per MTok.
    // main_solver: "deepseek-ai/DeepSeek-V4-Pro-0813:together",
    // full_verification: "zai-org/GLM-5.2:together",
    // step_verification: "zai-org/GLM-5.2:together",
    // computation: "deepseek-ai/DeepSeek-V4-Flash-0731:together",
    // cy_analyst: "deepseek-ai/DeepSeek-V4-Pro-0813:together",
    // proof_narrator: "deepseek-ai/DeepSeek-V4-Flash-0731:together",
    //
    // Gemini fast configuration (list state Sep 2026): Gemini 3.8 Flash
    // everywhere — $0.75/$3.75 per MTok with a 1M context, thinking_level
    // HIGH for solving and verification.
    // main_solver: "gemini-3.8-flash",
    // full_verification: "gemini-3.8-flash",
    // step_verification: "gemini-3.8-flash",
    // computation: "gemini-3.8-flash",
    // cy_analyst: "gemini-3.8-flash",
    // proof_narrator: "gemini-3.8-flash",

    reference_seeker: "gpt-5.6-luna",
    side_talk: "gpt-5.6-terra",
  },
};

const EFFORT_MATRIX: Matrix<ReasoningEffort> = {
  high: {
    main_solver: "high",
    full_verification: "high",
    step_verification: "high",
    computation: "high",
    cy_analyst: "high",
    reference_seeker: "medium",
    proof_narrator: "medium",
    side_talk: "medium",
  },
  fast: {
    main_solver: "high",
    full_verification: "high",
    step_verification: "high",
    computation: "high",
    cy_analyst: "high",
    reference_seeker: "medium",
    proof_narrator: "low",
    side_talk: "high",
  },
};

const CLIENT_BY_PROVIDER: Record<
  LlmProvider,
  typeof openaiClient | typeof claudeClient | typeof hfClient | typeof geminiClient
> = {
  openai: openaiClient,
  claude: claudeClient,
  huggingface: hfClient,
  gemini: geminiClient,
};

/**
 * Test-only routing overrides, keyed by `${speed}:${role}`. Provider-specific
 * loop tests pin the (speed, role) they exercise to a given back-end so they
 * keep passing whatever the matrices above currently say. Never populated in
 * production code paths.
 */
const ROUTING_OVERRIDES = new Map<string, Partial<LlmTarget>>();

export function overrideRoutingForTests(
  speed: ReasoningSpeed,
  role: ReasoningRole,
  target: Partial<LlmTarget>,
): () => void {
  const key = `${speed}:${role}`;
  ROUTING_OVERRIDES.set(key, target);
  return () => {
    ROUTING_OVERRIDES.delete(key);
  };
}

export function providerFor(
  speed: ReasoningSpeed = "high",
  role: ReasoningRole = "main_solver",
): LlmProvider {
  return targetFor(speed, role).provider;
}

export function modelFor(
  speed: ReasoningSpeed = "high",
  role: ReasoningRole = "main_solver",
): string {
  return targetFor(speed, role).model;
}

export function effortFor(
  speed: ReasoningSpeed = "high",
  role: ReasoningRole = "main_solver",
): ReasoningEffort {
  return targetFor(speed, role).effort;
}

function targetFor(
  speed: ReasoningSpeed = "high",
  role: ReasoningRole = "main_solver",
): LlmTarget {
  const override = ROUTING_OVERRIDES.get(`${speed}:${role}`);
  return {
    provider: override?.provider ?? PROVIDER_MATRIX[speed][role],
    model: override?.model ?? MODEL_MATRIX[speed][role],
    effort: override?.effort ?? EFFORT_MATRIX[speed][role],
  };
}

/**
 * True when `err` indicates a broken `previous_response_id` chain: the
 * in-process cache of the Claude / HuggingFace / Gemini emulation was
 * evicted, or OpenAI no longer has the stored response (expired, deleted, or
 * lost).
 * Chained sub-agent loops treat this as recoverable — their tasks are
 * stateless, so they restart from their initial input instead of failing
 * the whole verification / computation tool call.
 */
export function isMissingPreviousResponseError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = String((err as { message?: unknown }).message ?? "");
  // claudeClient / hfClient / geminiClient emulation cache miss.
  if (message.includes("unknown previousResponseId")) return true;
  // OpenAI Responses API: 400/404 "Previous response with id '...' not found".
  const status = (err as { status?: number }).status;
  return (status === 400 || status === 404) && /previous response/i.test(message);
}

// -------------------------------------------------------------------------
// Public surface.
// -------------------------------------------------------------------------

/**
 * Resolve the provider for the requested (speed, role) and forward the
 * call to its underlying client with the matrix-derived `model` injected.
 * Token usage of the resolved response is recorded (best-effort) against the
 * ambient usage context for cost tracking.
 */
export async function createResponse(
  options: Omit<CreateResponseOptions, "model"> & { model?: string },
): Promise<Response> {
  const target = targetFor(options.reasoningSpeed, options.reasoningRole);
  const impl = CLIENT_BY_PROVIDER[target.provider];
  const model = options.model ?? target.model;
  const response = await impl.createResponse({ ...options, model });
  recordResponseUsageSafe({
    response,
    provider: target.provider,
    model,
    role: options.reasoningRole ?? "main_solver",
  });
  return response;
}

export async function runManualAgentLoop(
  options: Omit<ManualLoopOptions, "model"> & { model?: string },
): Promise<ManualLoopResult> {
  const { handlers, maxTurns, input: initialInput, ...rest } = options;
  const input: ResponseInputItem[] = [...initialInput];
  const responses: Response[] = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await createResponse({ ...rest, input });
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

    const calls = openaiClient.findFunctionCalls(response);
    if (calls.length === 0) {
      return {
        finalMessage: openaiClient.findFinalMessage(response),
        responses,
        finalInput: input,
      };
    }

    for (const call of calls) {
      const output = await handlers.onToolCall(call);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
    }
  }

  throw new Error(`Agent loop exceeded ${maxTurns} turns without producing a final message`);
}

export async function runPreviousResponseLoop(
  options: Omit<PreviousResponseLoopOptions, "model"> & { model?: string },
): Promise<PreviousResponseLoopResult> {
  const { handlers, maxTurns, initialInput, ...rest } = options;
  let nextInput: string | ResponseInputItem[] = initialInput;
  let previousResponseId: string | undefined;
  const responses: Response[] = [];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await createResponse({
      ...rest,
      input: nextInput,
      ...(previousResponseId ? { previousResponseId } : {}),
      store: rest.store ?? true,
    });
    responses.push(response);
    if (handlers.onTurn) {
      await handlers.onTurn(response);
    }
    previousResponseId = response.id;

    const calls = openaiClient.findFunctionCalls(response);
    if (calls.length === 0) {
      return {
        finalMessage: openaiClient.findFinalMessage(response),
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

// Pure helpers — operate on the OpenAI-shaped output items both clients emit.
export const extractAssistantText = openaiClient.extractAssistantText;
export const findFinalMessage = openaiClient.findFinalMessage;
export const findFunctionCalls = openaiClient.findFunctionCalls;
export const isAbort = openaiClient.isAbort;
export const isFunctionCall = openaiClient.isFunctionCall;
export const isMessage = openaiClient.isMessage;
export const isReasoning = openaiClient.isReasoning;
export const AbortError = openaiClient.AbortError;

export type {
  AgentLoopHandlers,
  CreateResponseOptions,
  ManualLoopOptions,
  ManualLoopResult,
  PreviousResponseLoopOptions,
  PreviousResponseLoopResult,
  ReasoningEffort,
  ReasoningRole,
};
export type { JsonSchemaResponseFormat } from "./openaiClient";
