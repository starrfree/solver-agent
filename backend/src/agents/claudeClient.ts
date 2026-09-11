import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageStreamParams,
  MessageParam,
  TextBlockParam,
  Tool as AnthropicTool,
  ToolChoice as AnthropicToolChoice,
  ToolUseBlockParam,
  ToolResultBlockParam,
  ThinkingBlockParam,
  RedactedThinkingBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
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

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY || undefined,
});

/** Anthropic's adaptive thinking effort axis. */
type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Map the shared reasoning-effort axis to Anthropic's adaptive-thinking
 * levels. `minimal` collapses to `low` since Anthropic has no equivalent
 * rung; `none` is omitted so thinking stays on its default path.
 */
function toClaudeEffort(effort: ReasoningEffort | undefined): ClaudeEffort | undefined {
  if (!effort || effort === "none") return undefined;
  switch (effort) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "xhigh";
    case "max":
      return "max";
    default:
      return "medium";
  }
}

const DEFAULT_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
// Claude Sonnet 4.6 caps non-beta requests at 64K output tokens, and adaptive
// thinking is billed out of this same budget. We want the most headroom for
// long proofs, so pin to that ceiling rather than trimming for cost.
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;

// -------------------------------------------------------------------------
// previous_response_id cache.
//
// Anthropic has no server-side state, so we keep the conversation history
// in-process keyed by the synthetic response id we hand back. Each entry
// holds the FULL `MessageParam[]` up to and including the assistant turn
// that produced the id; the next call appends new (translated) input items
// before dispatching to the API.
// -------------------------------------------------------------------------

interface CachedConversation {
  messages: MessageParam[];
  /** Last time this entry was stored or recalled (drives LRU + TTL). */
  touchedAt: number;
}

const MAX_CONVERSATION_CACHE = 256;
/**
 * How long an unused chain is kept before it is swept. Callers that resend the
 * full input array each turn (main solver, full verification) never recall the
 * ids they produce, so without a TTL those would accumulate until they hit the
 * size cap; the sweep reclaims them promptly instead.
 */
const CONVERSATION_TTL_MS = 30 * 60_000;

// JavaScript `Map` preserves insertion order, so the first key is always the
// least-recently-used once we re-insert on every store/recall.
const conversationCache = new Map<string, CachedConversation>();

function sweepExpired(now: number): void {
  for (const [key, value] of conversationCache) {
    if (now - value.touchedAt > CONVERSATION_TTL_MS) {
      conversationCache.delete(key);
    }
  }
}

function rememberConversation(id: string, messages: MessageParam[]): void {
  const now = Date.now();
  sweepExpired(now);
  // Re-insert so this id moves to the most-recently-used end.
  conversationCache.delete(id);
  while (conversationCache.size >= MAX_CONVERSATION_CACHE) {
    const oldestKey = conversationCache.keys().next().value;
    if (oldestKey === undefined) break;
    conversationCache.delete(oldestKey);
  }
  conversationCache.set(id, { messages, touchedAt: now });
}

function recallConversation(id: string): MessageParam[] | undefined {
  const cached = conversationCache.get(id);
  if (!cached) return undefined;
  // LRU: mark most-recently-used and refresh its TTL window so an actively
  // chained conversation is never evicted out from under an in-flight run.
  conversationCache.delete(id);
  cached.touchedAt = Date.now();
  conversationCache.set(id, cached);
  return cached.messages;
}

/**
 * Drop a chain predecessor once it has been superseded by a newer response id.
 * The agent loops only ever recall the latest id in a chain, so the previous
 * one will never be needed again — forgetting it caps each active chain at a
 * single cached entry instead of one per turn.
 */
function forgetConversation(id: string): void {
  conversationCache.delete(id);
}

// -------------------------------------------------------------------------
// Input translation: OpenAI ResponseInputItem[] → Anthropic system + messages.
// -------------------------------------------------------------------------

interface TranslatedInput {
  system: string | undefined;
  messages: MessageParam[];
}

/**
 * Group OpenAI-shaped input items into Anthropic `MessageParam` turns.
 * Developer / system messages are collected into the top-level `system`
 * prompt; assistant / user content is emitted as alternating message
 * params. Reasoning items round-trip via `thinking` blocks that preserve
 * the original Anthropic `signature` we stashed during the previous turn.
 */
function translateInputItems(items: ResponseInputItem[]): TranslatedInput {
  const systemChunks: string[] = [];
  const messages: MessageParam[] = [];

  type PendingKind = "regular" | "tool_result";
  type Pending = {
    role: "user" | "assistant";
    kind: PendingKind;
    blocks: ContentBlockParam[];
  };
  let pending: Pending | null = null;

  const flush = () => {
    if (pending && pending.blocks.length > 0) {
      messages.push({ role: pending.role, content: pending.blocks });
    }
    pending = null;
  };

  const push = (
    role: "user" | "assistant",
    blocks: ContentBlockParam[],
    kind: PendingKind = "regular",
  ) => {
    if (blocks.length === 0) return;
    if (!pending || pending.role !== role || pending.kind !== kind) {
      flush();
      pending = { role, kind, blocks: [...blocks] };
    } else {
      pending.blocks.push(...blocks);
    }
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
        push("assistant", messageContentToBlocks(content, "assistant"), "regular");
        continue;
      }
      push("user", messageContentToBlocks(content, "user"), "regular");
      continue;
    }

    if (item.type === "function_call") {
      const call = item as unknown as ResponseFunctionToolCall;
      let parsedInput: unknown = {};
      try {
        parsedInput = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        parsedInput = { __raw: call.arguments };
      }
      const block: ToolUseBlockParam = {
        type: "tool_use",
        id: call.call_id,
        name: call.name,
        input: parsedInput,
      };
      push("assistant", [block], "regular");
      continue;
    }

    if (item.type === "function_call_output") {
      const callOut = item as unknown as { call_id: string; output: unknown };
      const block: ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: callOut.call_id,
        content: toolResultContent(callOut.output),
      };
      // Keep tool_result blocks in a dedicated user message (or a dedicated
      // consecutive run of tool_result blocks), never mixed with regular
      // user text/image blocks. Anthropic requires strict adjacency between
      // assistant tool_use and the next user tool_result message.
      push("user", [block], "tool_result");
      continue;
    }

    if (item.type === "reasoning") {
      const reasoning = item as unknown as ResponseReasoningItem & {
        __claudeSignature?: string;
        __claudeRedactedData?: string;
      };
      if (reasoning.__claudeRedactedData) {
        push("assistant", [
          {
            type: "redacted_thinking",
            data: reasoning.__claudeRedactedData,
          } satisfies RedactedThinkingBlockParam,
        ], "regular");
        continue;
      }
      if (reasoning.__claudeSignature) {
        const text =
          (reasoning.content ?? [])
            .filter((c) => c.type === "reasoning_text")
            .map((c) => c.text)
            .join("") ||
          (reasoning.summary ?? [])
            .filter((s) => s.type === "summary_text")
            .map((s) => s.text)
            .join("");
        push("assistant", [
          {
            type: "thinking",
            thinking: text,
            signature: reasoning.__claudeSignature,
          } satisfies ThinkingBlockParam,
        ], "regular");
      }
      // Reasoning items without a signature originated from a different
      // provider (or were synthesized) — drop them since Anthropic rejects
      // unsigned thinking blocks.
      continue;
    }

    // Other OpenAI-specific item types (computer_call, web_search, ...) are
    // not produced by this codebase, so we silently drop them.
  }

  flush();

  return {
    system: systemChunks.length > 0 ? systemChunks.join("\n\n") : undefined,
    messages,
  };
}

// -------------------------------------------------------------------------
// Defensive sanitizer.
//
// Anthropic enforces strict adjacency: every assistant `tool_use` block
// MUST be followed by a user message that begins with `tool_result` blocks
// covering each tool_use id. Any violation here causes a 400 from the
// Messages API ("messages.N: `tool_use` ids were found without
// `tool_result` blocks immediately after"). Despite our best efforts in
// the agent loops, edge cases (model emitting both tool_use and text in
// the same turn, recovered-after-restart inputs, etc.) can still produce
// orphan tool_use blocks. We patch up any orphans here by inserting
// synthetic `tool_result` blocks so the request stays valid, and log a
// warning so the surfacing issue can be investigated.
// -------------------------------------------------------------------------

function sanitizeMessagesForAnthropic(
  messages: MessageParam[],
  context: { previousResponseId?: string },
): MessageParam[] {
  const result: MessageParam[] = [];
  let repairs = 0;

  for (let i = 0; i < messages.length; i += 1) {
    const current = messages[i];
    if (!current) continue;

    result.push(current);

    if (current.role !== "assistant") continue;
    const toolUseIds = collectToolUseIds(current);
    if (toolUseIds.length === 0) continue;

    const next = messages[i + 1];
    const nextToolResultIds =
      next && next.role === "user" ? collectToolResultIds(next) : new Set<string>();

    const missing = toolUseIds.filter((id) => !nextToolResultIds.has(id));
    if (missing.length === 0) continue;

    repairs += missing.length;
    const synthetic: ToolResultBlockParam[] = missing.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      is_error: true,
      content:
        "Tool result missing from the recorded conversation; synthesized to keep the protocol valid.",
    }));

    if (next && next.role === "user") {
      const existing = Array.isArray(next.content) ? [...next.content] : [];
      const merged: MessageParam = {
        role: "user",
        content: [...synthetic, ...existing],
      };
      result.push(merged);
      i += 1;
    } else {
      result.push({ role: "user", content: synthetic });
    }
  }

  if (repairs > 0) {
    logger.warn(
      {
        repairs,
        previousResponseId: context.previousResponseId,
        roles: result.map((m) => m.role),
      },
      "Claude client inserted synthetic tool_result blocks to satisfy Anthropic adjacency",
    );
  }

  return result;
}

function collectToolUseIds(message: MessageParam): string[] {
  if (!Array.isArray(message.content)) return [];
  const ids: string[] = [];
  for (const block of message.content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "tool_use") {
      const id = (block as { id?: string }).id;
      if (typeof id === "string" && id.length > 0) ids.push(id);
    }
  }
  return ids;
}

function collectToolResultIds(message: MessageParam): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(message.content)) return out;
  for (const block of message.content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "tool_result"
    ) {
      const id = (block as { tool_use_id?: string }).tool_use_id;
      if (typeof id === "string" && id.length > 0) out.add(id);
    }
  }
  return out;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as { type?: string; text?: string };
      if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
        return p.text ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function messageContentToBlocks(
  content: unknown,
  role: "user" | "assistant",
): ContentBlockParam[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content } satisfies TextBlockParam];
  }
  if (!Array.isArray(content)) return [];

  const blocks: ContentBlockParam[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as {
      type?: string;
      text?: string;
      image_url?: string;
      refusal?: string;
    };
    if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
      if (p.text) blocks.push({ type: "text", text: p.text });
      continue;
    }
    if (p.type === "refusal") {
      blocks.push({ type: "text", text: `[refusal] ${p.refusal ?? ""}` });
      continue;
    }
    if (p.type === "input_image" && role === "user" && typeof p.image_url === "string") {
      const block = imageBlockFromUrl(p.image_url);
      if (block) blocks.push(block);
      continue;
    }
  }
  return blocks;
}

function imageBlockFromUrl(url: string): ContentBlockParam | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (m) {
    const [, mediaType, data] = m;
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        data,
      },
    };
  }
  return {
    type: "image",
    source: { type: "url", url },
  };
}

function toolResultContent(
  output: unknown,
): ToolResultBlockParam["content"] {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const blocks: TextBlockParam[] = [];
    for (const part of output) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; text?: string };
      if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
        if (p.text) blocks.push({ type: "text", text: p.text });
      }
    }
    return blocks.length > 0 ? blocks : "";
  }
  if (output == null) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

// -------------------------------------------------------------------------
// Tools translation: OpenAI FunctionTool → Anthropic Tool.
// -------------------------------------------------------------------------

function translateTools(tools: FunctionTool[] | undefined): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => {
    const params = (t.parameters ?? {
      type: "object",
      properties: {},
    }) as AnthropicTool["input_schema"];
    const result: AnthropicTool = {
      name: t.name,
      input_schema: params,
    };
    if (t.description) result.description = t.description;
    return result;
  });
}

function translateToolChoice(
  toolChoice: ResponseCreateParamsNonStreaming["tool_choice"] | undefined,
  parallelToolCalls: boolean | undefined,
): AnthropicToolChoice | undefined {
  const disableParallel = parallelToolCalls === false;
  if (toolChoice === undefined) {
    return disableParallel ? { type: "auto", disable_parallel_tool_use: true } : undefined;
  }
  if (toolChoice === "auto") {
    return { type: "auto", ...(disableParallel ? { disable_parallel_tool_use: true } : {}) };
  }
  if (toolChoice === "required") {
    return { type: "any", ...(disableParallel ? { disable_parallel_tool_use: true } : {}) };
  }
  if (toolChoice === "none") {
    return { type: "none" };
  }
  if (typeof toolChoice === "object" && toolChoice && (toolChoice as { type?: string }).type === "function") {
    const name = (toolChoice as { name?: string }).name;
    if (name) {
      return { type: "tool", name, ...(disableParallel ? { disable_parallel_tool_use: true } : {}) };
    }
  }
  return disableParallel ? { type: "auto", disable_parallel_tool_use: true } : undefined;
}

// -------------------------------------------------------------------------
// Response translation: Anthropic Message → OpenAI Response shape.
// -------------------------------------------------------------------------

function translateMessageToResponse(message: Message): Response {
  const output: ResponseOutputItem[] = [];
  const textParts: { type: "output_text"; text: string; annotations: [] }[] = [];

  for (const block of message.content as ContentBlock[]) {
    switch (block.type) {
      case "thinking": {
        const item: ResponseReasoningItem & { __claudeSignature?: string } = {
          id: `claude_thinking_${output.length}`,
          type: "reasoning",
          summary: block.thinking
            ? [{ type: "summary_text", text: block.thinking }]
            : [],
          content: block.thinking
            ? [{ type: "reasoning_text", text: block.thinking }]
            : [],
        };
        item.__claudeSignature = block.signature;
        output.push(item);
        break;
      }
      case "redacted_thinking": {
        const item: ResponseReasoningItem & { __claudeRedactedData?: string } = {
          id: `claude_redacted_${output.length}`,
          type: "reasoning",
          summary: [],
          content: [],
        };
        item.__claudeRedactedData = block.data;
        output.push(item);
        break;
      }
      case "text": {
        textParts.push({ type: "output_text", text: block.text, annotations: [] });
        break;
      }
      case "tool_use": {
        const call: ResponseFunctionToolCall = {
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
          id: block.id,
        };
        output.push(call as ResponseOutputItem);
        break;
      }
      default:
        // Server-tool blocks (web_search, code_execution, ...) are not
        // enabled by this codebase. Drop silently.
        break;
    }
  }

  if (textParts.length > 0) {
    const msg: ResponseOutputMessage = {
      id: `claude_message_${message.id}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: textParts,
    };
    output.push(msg);
  }

  const aggregateText = textParts.map((p) => p.text).join("");

  // Map Anthropic usage into the OpenAI Responses `usage` shape so the shared
  // cost-tracking path in `llmClient.createResponse` works regardless of
  // provider. Anthropic reports cache reads separately and has no reasoning
  // token counter, and its `input_tokens` excludes cached reads, so fold the
  // cache-read count back in to mirror OpenAI's "cached is a subset of input".
  const u = message.usage;
  const cachedInput = u?.cache_read_input_tokens ?? 0;
  const inputTokens = (u?.input_tokens ?? 0) + cachedInput;
  const outputTokens = u?.output_tokens ?? 0;

  return {
    id: message.id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    output,
    output_text: aggregateText,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: message.model,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: cachedInput },
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: inputTokens + outputTokens,
    },
  } as unknown as Response;
}

// -------------------------------------------------------------------------
// createResponse – Claude implementation.
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
      `claudeClient: unknown previousResponseId '${options.previousResponseId}'. ` +
        "The Anthropic provider keeps conversation state in-process; the cache may have been evicted.",
    );
  }

  const translatedNew = translateInputItems(newItems);
  const rawMessages: MessageParam[] = prior
    ? [...prior, ...translatedNew.messages]
    : translatedNew.messages;
  const messages = sanitizeMessagesForAnthropic(rawMessages, {
    ...(options.previousResponseId !== undefined
      ? { previousResponseId: options.previousResponseId }
      : {}),
  });
  const system = mergeSystem(
    options.instructions,
    translatedNew.system,
  );

  const claudeEffort = toClaudeEffort(
    (options.reasoning?.effort ?? undefined) as ReasoningEffort | undefined,
  );
  const tools = translateTools(options.tools);
  const toolChoice = translateToolChoice(options.toolChoice, options.parallelToolCalls);

  const body: MessageCreateParamsNonStreaming = {
    model: options.model,
    max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages,
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    thinking: { type: "adaptive" },
    ...(options.responseFormat || claudeEffort
      ? {
          output_config: {
            ...(claudeEffort ? { effort: claudeEffort } : {}),
            ...(options.responseFormat
              ? { format: { type: "json_schema", schema: options.responseFormat.schema } }
              : {}),
          },
        }
      : {}),
    ...(options.promptCacheKey ? { metadata: { user_id: options.promptCacheKey } } : {}),
  };

  const requestOptions = options.signal ? { signal: options.signal } : undefined;

  let attempt = 0;
  let lastError: unknown;
  while (attempt < DEFAULT_RETRIES) {
    attempt += 1;
    if (options.signal?.aborted) {
      throw new AbortError("Aborted before Anthropic Messages API call");
    }
    try {
      // Anthropic enforces streaming for large max_tokens requests. Use the
      // SDK stream helper and collect the final message to keep our existing
      // non-streaming call contract.
      const stream = anthropic.messages.stream(body as MessageStreamParams, requestOptions);
      const message = (await stream.finalMessage()) as Message;
      const response = translateMessageToResponse(message);
      rememberConversation(response.id, [
        ...messages,
        { role: "assistant", content: message.content as ContentBlockParam[] },
      ]);
      // The predecessor in this chain (if any) is now superseded and will
      // never be recalled again — drop it so the chain stays at one entry.
      if (options.previousResponseId !== undefined) {
        forgetConversation(options.previousResponseId);
      }
      return response;
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
        "Anthropic Messages API call failed, retrying",
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
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
// Generic agent loops — identical control flow to openaiClient, with the
// only difference being that createResponse is the Claude-backed one above.
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
// single module if they pick the Claude provider.
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
