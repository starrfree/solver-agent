import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import type {
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
} from "openai/resources/responses/responses";

import { env } from "../config/env";
import { logger } from "../util/logger";

import {
  AbortError,
  extractAssistantText,
  findFinalMessage,
  findFunctionCalls,
  isAbort,
  isFunctionCall,
  isMessage,
  isReasoning,
  type AgentLoopHandlers,
  type CreateResponseOptions,
  type JsonSchemaResponseFormat,
  type ManualLoopOptions,
  type ManualLoopResult,
  type PreviousResponseLoopOptions,
  type PreviousResponseLoopResult,
  type ReasoningEffort,
  type ReasoningRole,
} from "./openaiClient";

/**
 * HuggingFace router client. The router speaks the OpenAI Chat Completions
 * dialect, so we reuse the OpenAI SDK pointed at the HF base URL. Pin a backend
 * with a `:provider` suffix on the model id (e.g. `:together`); see
 * `llmClient.FAST_HF_MODEL` for the fast-mode default.
 */
export const hf = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: env.HUGGINGFACE_API_KEY || "hf-placeholder",
});

const DEFAULT_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
// DeepSeek V4 Pro is thinking-by-default and emits very long chains of thought
// out of this same budget before the answer/tool call. Together's 512K context
// gives ample room, so pin a generous ceiling for the best results rather than
// trimming for cost.
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;

// -------------------------------------------------------------------------
// previous_response_id cache.
//
// The HF Responses beta silently drops `previous_response_id`/`store`, and we
// talk to it via Chat Completions anyway, so there is no server-side state.
// We keep the conversation history in-process keyed by the synthetic response
// id we hand back. Each entry holds the FULL `ChatCompletionMessageParam[]` up
// to and including the assistant turn that produced the id; the next call
// appends new (translated) input items before dispatching to the API.
// -------------------------------------------------------------------------

interface CachedConversation {
  messages: ChatCompletionMessageParam[];
  insertedAt: number;
}

const MAX_CONVERSATION_CACHE = 256;
const conversationCache = new Map<string, CachedConversation>();

function rememberConversation(id: string, messages: ChatCompletionMessageParam[]): void {
  if (conversationCache.size >= MAX_CONVERSATION_CACHE) {
    const oldestKey = conversationCache.keys().next().value;
    if (oldestKey !== undefined) conversationCache.delete(oldestKey);
  }
  conversationCache.set(id, { messages, insertedAt: Date.now() });
}

function recallConversation(id: string): ChatCompletionMessageParam[] | undefined {
  return conversationCache.get(id)?.messages;
}

// -------------------------------------------------------------------------
// Input translation: OpenAI ResponseInputItem[] → chat messages.
// -------------------------------------------------------------------------

interface TranslatedInput {
  system: string | undefined;
  messages: ChatCompletionMessageParam[];
}

/**
 * Assistant message param extended with DeepSeek's `reasoning_content`. The
 * OpenAI Chat Completions types do not declare this field, but the HF router /
 * Together pass it through, and DeepSeek V4 Pro REQUIRES the reasoning trace of
 * any tool-calling turn to be echoed back on every subsequent request (missing
 * it returns a 400). We carry it on the assistant message and let the SDK
 * forward the extra key verbatim.
 */
type AssistantParamWithReasoning = ChatCompletionAssistantMessageParam & {
  reasoning_content?: string;
};

/**
 * Translate OpenAI-shaped Responses input items into Chat Completions
 * messages. Developer / system messages are collected into a `system` chunk;
 * assistant / user content is emitted as chat messages; `function_call`
 * becomes an assistant `tool_calls` entry and `function_call_output` becomes a
 * `tool` message. Reasoning items carrying `__deepseekReasoning` are folded
 * back into the assistant message that immediately follows them as
 * `reasoning_content` (foreign / unsigned reasoning is still dropped, since
 * chat models reject bare reasoning turns on input).
 */
function translateInputItems(items: ResponseInputItem[]): TranslatedInput {
  const systemChunks: string[] = [];
  const messages: ChatCompletionMessageParam[] = [];
  // Reasoning items precede the assistant turn (tool_calls or text) they
  // belong to; stash the text and attach it to that next assistant message.
  let pendingReasoning: string | undefined;

  const attachReasoning = (msg: AssistantParamWithReasoning) => {
    if (pendingReasoning) {
      msg.reasoning_content = pendingReasoning;
      pendingReasoning = undefined;
    }
    return msg;
  };

  for (const raw of items) {
    const item = raw as ResponseInputItem & Record<string, unknown>;

    if (item.type === "message" || item.type === undefined) {
      const role = (item as { role?: string }).role;
      const content = (item as { content?: unknown }).content;
      if (role === "developer" || role === "system") {
        systemChunks.push(stringifyMessageContent(content));
        continue;
      }
      if (role === "assistant") {
        const text = stringifyMessageContent(content);
        if (text) {
          messages.push(attachReasoning({ role: "assistant", content: text }));
        }
        continue;
      }
      messages.push({ role: "user", content: userContentToParts(content) });
      continue;
    }

    if (item.type === "function_call") {
      const call = item as unknown as ResponseFunctionToolCall;
      const toolCall: ChatCompletionMessageToolCall = {
        id: call.call_id,
        type: "function",
        function: { name: call.name, arguments: call.arguments ?? "{}" },
      };
      const prev = messages[messages.length - 1];
      if (
        prev &&
        prev.role === "assistant" &&
        Array.isArray((prev as ChatCompletionAssistantMessageParam).tool_calls)
      ) {
        (prev as ChatCompletionAssistantMessageParam).tool_calls!.push(toolCall);
      } else {
        messages.push(attachReasoning({ role: "assistant", tool_calls: [toolCall] }));
      }
      continue;
    }

    if (item.type === "function_call_output") {
      const callOut = item as unknown as { call_id: string; output: unknown };
      messages.push({
        role: "tool",
        tool_call_id: callOut.call_id,
        content: toolOutputToString(callOut.output),
      });
      continue;
    }

    if (item.type === "reasoning") {
      const reasoning = item as unknown as ResponseReasoningItem & {
        __deepseekReasoning?: string;
      };
      if (
        typeof reasoning.__deepseekReasoning === "string" &&
        reasoning.__deepseekReasoning.length > 0
      ) {
        pendingReasoning = reasoning.__deepseekReasoning;
      }
      // Unsigned / foreign reasoning carries no echo-back token; drop it.
      continue;
    }

    // Any other OpenAI-specific item types are dropped.
  }

  return {
    system: systemChunks.length > 0 ? systemChunks.join("\n\n") : undefined,
    messages,
  };
}

// -------------------------------------------------------------------------
// Defensive sanitizer.
//
// Chat Completions requires that every assistant message carrying `tool_calls`
// is followed by `tool` messages answering each `tool_call_id` before the next
// assistant turn. The agent loops append items in model-emit order, which can
// interleave an assistant text message between the tool_calls and their
// outputs. We reorder each tool message to sit immediately after its
// originating assistant message and synthesize any missing ones so the request
// stays valid.
// -------------------------------------------------------------------------

function sanitizeMessagesForChat(
  messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];
  const used = new Array(messages.length).fill(false);
  let repairs = 0;

  for (let i = 0; i < messages.length; i += 1) {
    if (used[i]) continue;
    const current = messages[i];
    if (!current) continue;
    result.push(current);
    used[i] = true;

    if (current.role !== "assistant") continue;
    const toolCalls = (current as ChatCompletionAssistantMessageParam).tool_calls;
    if (!toolCalls || toolCalls.length === 0) continue;

    for (const tc of toolCalls) {
      let foundIndex = -1;
      for (let j = i + 1; j < messages.length; j += 1) {
        if (used[j]) continue;
        const cand = messages[j];
        if (
          cand &&
          cand.role === "tool" &&
          (cand as ChatCompletionToolMessageParam).tool_call_id === tc.id
        ) {
          foundIndex = j;
          break;
        }
      }
      if (foundIndex >= 0) {
        result.push(messages[foundIndex]!);
        used[foundIndex] = true;
      } else {
        repairs += 1;
        result.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "Tool result missing from the recorded conversation; synthesized to keep the protocol valid.",
        });
      }
    }
  }

  if (repairs > 0) {
    logger.warn(
      { repairs },
      "HuggingFace client inserted synthetic tool results to satisfy chat tool-call adjacency",
    );
  }

  return result;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as { type?: string; text?: string; refusal?: string };
      if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
        return p.text ?? "";
      }
      if (p.type === "refusal") return `[refusal] ${p.refusal ?? ""}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function userContentToParts(content: unknown): string | ChatCompletionContentPart[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: ChatCompletionContentPart[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as { type?: string; text?: string; image_url?: string; refusal?: string };
    if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
      if (p.text) parts.push({ type: "text", text: p.text });
      continue;
    }
    if (p.type === "refusal") {
      parts.push({ type: "text", text: `[refusal] ${p.refusal ?? ""}` });
      continue;
    }
    if (p.type === "input_image" && typeof p.image_url === "string") {
      parts.push({ type: "image_url", image_url: { url: p.image_url } });
      continue;
    }
  }

  if (parts.length === 0) return "";
  if (parts.every((part) => part.type === "text")) {
    return parts.map((part) => (part as ChatCompletionContentPartText).text).join("\n");
  }
  return parts;
}

function toolOutputToString(output: unknown): string {
  if (typeof output === "string") return output;
  if (output == null) return "";
  if (Array.isArray(output)) {
    const texts: string[] = [];
    for (const part of output) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; text?: string };
      if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
        if (p.text) texts.push(p.text);
      }
    }
    if (texts.length > 0) return texts.join("\n");
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

// -------------------------------------------------------------------------
// Tools translation: OpenAI FunctionTool → Chat Completions tool.
// -------------------------------------------------------------------------

function translateTools(tools: FunctionTool[] | undefined): ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: (t.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
      ...(typeof t.strict === "boolean" ? { strict: t.strict } : {}),
    },
  }));
}

function translateToolChoice(
  toolChoice: CreateResponseOptions["toolChoice"],
): ChatCompletionToolChoiceOption | undefined {
  if (toolChoice === undefined) return undefined;
  if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") {
    return toolChoice;
  }
  if (
    typeof toolChoice === "object" &&
    toolChoice &&
    (toolChoice as { type?: string }).type === "function"
  ) {
    const name = (toolChoice as { name?: string }).name;
    if (name) return { type: "function", function: { name } };
  }
  return undefined;
}

function translateResponseFormat(
  rf: JsonSchemaResponseFormat | undefined,
): ChatCompletionCreateParamsNonStreaming["response_format"] | undefined {
  if (!rf) return undefined;
  return {
    type: "json_schema",
    json_schema: {
      name: rf.name,
      schema: rf.schema,
      strict: rf.strict ?? true,
      ...(rf.description ? { description: rf.description } : {}),
    },
  };
}

// -------------------------------------------------------------------------
// Response translation: Chat Completions → OpenAI Response shape.
// -------------------------------------------------------------------------

function assistantMessageToParam(
  message: ChatCompletionMessage,
): ChatCompletionAssistantMessageParam {
  const param: AssistantParamWithReasoning = { role: "assistant" };
  if (message.content) param.content = message.content;
  // Preserve DeepSeek's reasoning trace so the cached-history replay path
  // (previous_response_id) re-sends it on tool-calling turns as required.
  const reasoning = (message as ChatMessageWithReasoning).reasoning_content;
  if (reasoning) param.reasoning_content = reasoning;
  if (message.tool_calls && message.tool_calls.length > 0) {
    param.tool_calls = message.tool_calls;
  }
  return param;
}

/** Completion message extended with DeepSeek's `reasoning_content` field. */
type ChatMessageWithReasoning = ChatCompletionMessage & {
  reasoning_content?: string | null;
};

function translateCompletionToResponse(completion: ChatCompletion, responseId: string): Response {
  const message = completion.choices[0]?.message;
  const output: ResponseOutputItem[] = [];

  // Emit the reasoning trace first so it round-trips ahead of the tool calls it
  // justifies. DeepSeek V4 Pro requires this trace to be echoed back on every
  // subsequent request of a tool-calling turn.
  const reasoningText = (message as ChatMessageWithReasoning | undefined)?.reasoning_content ?? "";
  if (reasoningText) {
    const reasoningItem: ResponseReasoningItem & { __deepseekReasoning?: string } = {
      id: `hf_reasoning_${responseId}`,
      type: "reasoning",
      summary: [{ type: "summary_text", text: reasoningText }],
      content: [{ type: "reasoning_text", text: reasoningText }],
    };
    reasoningItem.__deepseekReasoning = reasoningText;
    output.push(reasoningItem as ResponseOutputItem);
  }

  for (const tc of message?.tool_calls ?? []) {
    if (tc.type !== "function") continue;
    const call: ResponseFunctionToolCall = {
      type: "function_call",
      call_id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments ?? "{}",
      id: tc.id,
    };
    output.push(call as ResponseOutputItem);
  }

  const text = message?.content ?? "";
  if (text) {
    const msg: ResponseOutputMessage = {
      id: `hf_message_${responseId}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };
    output.push(msg);
  }

  const u = completion.usage;
  const inputTokens = u?.prompt_tokens ?? 0;
  const cachedInput = u?.prompt_tokens_details?.cached_tokens ?? 0;
  const outputTokens = u?.completion_tokens ?? 0;
  const reasoningTokens = u?.completion_tokens_details?.reasoning_tokens ?? 0;

  return {
    id: responseId,
    object: "response",
    created_at: completion.created ?? Math.floor(Date.now() / 1000),
    output,
    output_text: text,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: completion.model,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: cachedInput },
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: reasoningTokens },
      total_tokens: u?.total_tokens ?? inputTokens + outputTokens,
    },
  } as unknown as Response;
}

function mergeSystem(
  instructions: string | undefined,
  systemFromInput: string | undefined,
): string | undefined {
  const chunks: string[] = [];
  if (instructions) chunks.push(instructions);
  if (systemFromInput) chunks.push(systemFromInput);
  return chunks.length > 0 ? chunks.join("\n\n") : undefined;
}

// -------------------------------------------------------------------------
// createResponse – HuggingFace (chat completions) implementation.
// -------------------------------------------------------------------------

export async function createResponse(options: CreateResponseOptions): Promise<Response> {
  const input = options.input;
  const newItems: ResponseInputItem[] = Array.isArray(input)
    ? input
    : [{ type: "message", role: "user", content: input } as ResponseInputItem];

  const prior =
    options.previousResponseId !== undefined
      ? recallConversation(options.previousResponseId)
      : undefined;
  if (options.previousResponseId !== undefined && !prior) {
    throw new Error(
      `hfClient: unknown previousResponseId '${options.previousResponseId}'. ` +
        "The HuggingFace provider keeps conversation state in-process; the cache may have been evicted.",
    );
  }

  const translatedNew = translateInputItems(newItems);
  const system = mergeSystem(options.instructions, translatedNew.system);

  const baseMessages: ChatCompletionMessageParam[] = prior ? [...prior] : [];
  // System instructions are injected once at the head of a conversation; on
  // continuation turns the cached prior history already carries them.
  if (!prior && system) {
    baseMessages.unshift({ role: "system", content: system });
  }
  const messages = sanitizeMessagesForChat([...baseMessages, ...translatedNew.messages]);

  const tools = translateTools(options.tools);
  const toolChoice = translateToolChoice(options.toolChoice);
  const responseFormat = translateResponseFormat(options.responseFormat);
  const effort = (options.reasoning?.effort ?? undefined) as ReasoningEffort | undefined;

  const body: ChatCompletionCreateParamsNonStreaming = {
    model: options.model,
    messages,
    max_completion_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(typeof options.parallelToolCalls === "boolean"
      ? { parallel_tool_calls: options.parallelToolCalls }
      : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    // GLM via Together accepts `max`; cast only satisfies the OpenAI SDK type.
    ...(effort
      ? { reasoning_effort: effort as NonNullable<import("openai/resources/shared").Reasoning["effort"]> }
      : {}),
    // Stable cache key for repeated system prompts (mirrors OpenAI prompt_cache_key).
    ...(options.promptCacheKey ? { user: options.promptCacheKey } : {}),
  };

  const requestOptions = options.signal ? { signal: options.signal } : undefined;

  let attempt = 0;
  let lastError: unknown;
  while (attempt < DEFAULT_RETRIES) {
    attempt += 1;
    if (options.signal?.aborted) {
      throw new AbortError("Aborted before HuggingFace Chat Completions call");
    }
    try {
      const completion = await hf.chat.completions.create(body, requestOptions);
      const responseId =
        completion.id || `hf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const response = translateCompletionToResponse(completion, responseId);
      const assistantMessage = completion.choices[0]?.message;
      rememberConversation(responseId, [
        ...messages,
        ...(assistantMessage ? [assistantMessageToParam(assistantMessage)] : []),
      ]);
      return response;
    } catch (err) {
      lastError = err;
      if (isAbort(err)) throw err;
      const status = (err as { status?: number }).status;
      if (status === 400) {
        // Most commonly: a tool-calling turn was replayed without its
        // reasoning_content (DeepSeek's interleaved-reasoning contract). Surface
        // it loudly instead of letting it look like a generic failure. Not
        // retryable — the same body would fail again.
        logger.error(
          { status, model: body.model, err },
          "HuggingFace Chat Completions returned 400 — check that reasoning_content is echoed back on tool-calling turns",
        );
        throw err;
      }
      const isRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);
      if (!isRetryable || attempt >= DEFAULT_RETRIES) {
        throw err;
      }
      const delayMs = 250 * Math.pow(2, attempt - 1);
      logger.warn(
        { attempt, status, delayMs },
        "HuggingFace Chat Completions call failed, retrying",
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// -------------------------------------------------------------------------
// Generic agent loops — identical control flow to openaiClient, with the only
// difference being that createResponse is the HuggingFace-backed one above.
// -------------------------------------------------------------------------

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

// Re-export the openai-side helpers so callers can import everything from a
// single module if they pick the HuggingFace provider.
export {
  AbortError,
  extractAssistantText,
  findFinalMessage,
  findFunctionCalls,
  isAbort,
  isFunctionCall,
  isMessage,
  isReasoning,
};
export type {
  AgentLoopHandlers,
  CreateResponseOptions,
  JsonSchemaResponseFormat,
  ManualLoopOptions,
  ManualLoopResult,
  PreviousResponseLoopOptions,
  PreviousResponseLoopResult,
  ReasoningEffort,
  ReasoningRole,
};
