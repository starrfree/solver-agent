import {
  FinishReason,
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";
import type {
  Content,
  FunctionDeclaration,
  GenerateContentConfig,
  GenerateContentResponse,
  Part,
  Tool as GeminiTool,
  ToolConfig,
} from "@google/genai";
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

/**
 * Google Gemini client (Gemini Developer API via `@google/genai`).
 *
 * Speaks the OpenAI Responses shape to the rest of the codebase and
 * translates to / from Gemini's `generateContent` request and response
 * natively: function declarations, thinking levels, thought signatures,
 * structured output (JSON schema), inline images, and usage metadata.
 *
 * The SDK's own HTTP retry loop is disabled so the retry policy below matches
 * the other back-ends (and so a retried call is not multiplied 5x).
 */
export const gemini = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY || "gemini-placeholder",
  httpOptions: { retryOptions: { attempts: 1 } },
});

const DEFAULT_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Documented dummy signature that tells the API to skip thought-signature
 * validation for a function call it did not itself generate (foreign-provider
 * history, synthesized calls). Used only when a `function_call` item carries
 * no Gemini signature; calls produced by this client always round-trip the
 * real signature.
 */
const SKIP_SIGNATURE_SENTINEL = "skip_thought_signature_validator";

/** Prefix of the synthetic call ids minted when Gemini returns none. */
const SYNTHETIC_CALL_PREFIX = "gemini_call_";

/**
 * Map the shared reasoning-effort axis to Gemini 3's `thinking_level`.
 * `MINIMAL` is not supported by every model (Pro and the newest Flash tiers
 * reject it), so `minimal` / `none` collapse to `LOW`; `xhigh` / `max`
 * collapse to `HIGH`, the deepest level Gemini exposes.
 */
function toThinkingLevel(effort: ReasoningEffort | undefined): ThinkingLevel | undefined {
  if (!effort) return undefined;
  switch (effort) {
    case "none":
    case "minimal":
    case "low":
      return ThinkingLevel.LOW;
    case "medium":
      return ThinkingLevel.MEDIUM;
    case "high":
    case "xhigh":
    case "max":
      return ThinkingLevel.HIGH;
    default:
      return ThinkingLevel.MEDIUM;
  }
}

// -------------------------------------------------------------------------
// previous_response_id cache.
//
// Gemini's generateContent API has no server-side conversation state, so we
// keep the history in-process keyed by the synthetic response id we hand
// back. Each entry holds the FULL `Content[]` up to and including the model
// turn that produced the id, plus the call-id → function-name map needed to
// build `functionResponse` parts for outputs sent on the next turn.
// -------------------------------------------------------------------------

interface CachedConversation {
  contents: Content[];
  callNames: Map<string, string>;
  /** Last time this entry was stored or recalled (drives LRU + TTL). */
  touchedAt: number;
}

const MAX_CONVERSATION_CACHE = 256;
const CONVERSATION_TTL_MS = 30 * 60_000;

const conversationCache = new Map<string, CachedConversation>();

function sweepExpired(now: number): void {
  for (const [key, value] of conversationCache) {
    if (now - value.touchedAt > CONVERSATION_TTL_MS) {
      conversationCache.delete(key);
    }
  }
}

function rememberConversation(
  id: string,
  contents: Content[],
  callNames: Map<string, string>,
): void {
  const now = Date.now();
  sweepExpired(now);
  conversationCache.delete(id);
  while (conversationCache.size >= MAX_CONVERSATION_CACHE) {
    const oldestKey = conversationCache.keys().next().value;
    if (oldestKey === undefined) break;
    conversationCache.delete(oldestKey);
  }
  conversationCache.set(id, { contents, callNames, touchedAt: now });
}

function recallConversation(id: string): CachedConversation | undefined {
  const cached = conversationCache.get(id);
  if (!cached) return undefined;
  conversationCache.delete(id);
  cached.touchedAt = Date.now();
  conversationCache.set(id, cached);
  return cached;
}

function forgetConversation(id: string): void {
  conversationCache.delete(id);
}

// -------------------------------------------------------------------------
// Input translation: OpenAI ResponseInputItem[] → Gemini system + contents.
// -------------------------------------------------------------------------

/** Private tags stashed on the output items this client emits. */
interface GeminiTaggedFunctionCall extends ResponseFunctionToolCall {
  __geminiThoughtSignature?: string;
}
interface GeminiTaggedReasoning extends ResponseReasoningItem {
  __geminiThoughtSignature?: string;
}
interface GeminiTaggedMessage extends ResponseOutputMessage {
  __geminiThoughtSignature?: string;
}

interface TranslatedInput {
  system: string | undefined;
  contents: Content[];
}

/**
 * Group OpenAI-shaped input items into Gemini `Content` turns.
 *
 * - developer / system messages → collected into the system instruction;
 * - assistant messages, `function_call` and signed `reasoning` items →
 *   consecutive runs become ONE `model` content (parallel function calls
 *   MUST stay in a single content for signature validation);
 * - user messages and `function_call_output` → consecutive runs become ONE
 *   `user` content with `functionResponse` parts placed first.
 *
 * Merging consecutive same-role runs keeps the wire history strictly
 * alternating, which the API is happiest with.
 */
function translateInputItems(
  items: ResponseInputItem[],
  callNames: Map<string, string>,
): TranslatedInput {
  const systemChunks: string[] = [];
  const contents: Content[] = [];

  let pending: { role: "user" | "model"; parts: Part[] } | null = null;

  const flush = () => {
    if (pending && pending.parts.length > 0) {
      contents.push({ role: pending.role, parts: orderUserParts(pending.role, pending.parts) });
    }
    pending = null;
  };

  const push = (role: "user" | "model", parts: Part[]) => {
    if (parts.length === 0) return;
    if (!pending || pending.role !== role) {
      flush();
      pending = { role, parts: [...parts] };
    } else {
      pending.parts.push(...parts);
    }
  };

  // First pass: learn the function name behind every call id so that
  // outputs can be answered with a properly named functionResponse.
  for (const raw of items) {
    if ((raw as { type?: string }).type === "function_call") {
      const call = raw as unknown as ResponseFunctionToolCall;
      if (call.call_id && call.name) callNames.set(call.call_id, call.name);
    }
  }

  for (const raw of items) {
    const item = raw as ResponseInputItem & Record<string, unknown>;

    if (item.type === "message" || item.type === undefined) {
      const role = (item as { role?: string }).role;
      const content = (item as { content?: unknown }).content;
      if (role === "developer" || role === "system") {
        const text = stringifyMessageContent(content);
        if (text) systemChunks.push(text);
        continue;
      }
      if (role === "assistant") {
        const parts = messageContentToParts(content, "model");
        const signature = (item as GeminiTaggedMessage).__geminiThoughtSignature;
        const last = parts[parts.length - 1];
        if (signature && last && typeof last.text === "string") {
          last.thoughtSignature = signature;
        }
        push("model", parts);
        continue;
      }
      push("user", messageContentToParts(content, "user"));
      continue;
    }

    if (item.type === "function_call") {
      const call = item as unknown as GeminiTaggedFunctionCall;
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = call.arguments ? JSON.parse(call.arguments) : {};
        args =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { __raw: parsed };
      } catch {
        args = { __raw: call.arguments };
      }
      const part: Part = {
        functionCall: {
          name: call.name,
          args,
          ...(isNativeCallId(call.call_id) ? { id: call.call_id } : {}),
        },
      };
      if (call.__geminiThoughtSignature) {
        part.thoughtSignature = call.__geminiThoughtSignature;
      }
      push("model", [part]);
      continue;
    }

    if (item.type === "function_call_output") {
      const callOut = item as unknown as { call_id: string; output: unknown };
      const name = callNames.get(callOut.call_id);
      if (!name) {
        logger.warn(
          { callId: callOut.call_id },
          "Gemini client could not resolve the function name for a tool output; using the call id",
        );
      }
      const part: Part = {
        functionResponse: {
          name: name ?? callOut.call_id,
          response: toolOutputToResponse(callOut.output),
          ...(isNativeCallId(callOut.call_id) ? { id: callOut.call_id } : {}),
        },
      };
      push("user", [part]);
      continue;
    }

    if (item.type === "reasoning") {
      const reasoning = item as unknown as GeminiTaggedReasoning;
      // Only thoughts that carry a Gemini signature are replayed (as thought
      // parts); unsigned / foreign reasoning is dropped — the model cannot use
      // it and it would only cost input tokens.
      if (reasoning.__geminiThoughtSignature) {
        const text =
          (reasoning.content ?? [])
            .filter((c) => c.type === "reasoning_text")
            .map((c) => c.text)
            .join("") ||
          (reasoning.summary ?? [])
            .filter((s) => s.type === "summary_text")
            .map((s) => s.text)
            .join("");
        push("model", [
          { thought: true, text, thoughtSignature: reasoning.__geminiThoughtSignature },
        ]);
      }
      continue;
    }

    // Other OpenAI-specific item types (computer_call, web_search, ...) are
    // not produced by this codebase, so we silently drop them.
  }

  flush();

  return {
    system: systemChunks.length > 0 ? systemChunks.join("\n\n") : undefined,
    contents,
  };
}

/** Within a user content, functionResponse parts must precede regular parts. */
function orderUserParts(role: "user" | "model", parts: Part[]): Part[] {
  if (role !== "user") return parts;
  const responses = parts.filter((p) => p.functionResponse);
  if (responses.length === 0 || responses.length === parts.length) return parts;
  return [...responses, ...parts.filter((p) => !p.functionResponse)];
}

function isNativeCallId(callId: string | undefined): boolean {
  return typeof callId === "string" && callId.length > 0 && !callId.startsWith(SYNTHETIC_CALL_PREFIX);
}

// -------------------------------------------------------------------------
// Defensive sanitizer.
//
// Gemini requires that a `model` content carrying N functionCall parts is
// followed by a `user` content whose functionResponse parts answer each of
// them (same count, same order), and that the first functionCall part of every
// step in the current turn carries a thought signature. The agent loops
// produce well-formed histories, but recovered / foreign inputs may not; we
// patch the gaps here (synthetic error responses, sentinel signature) so the
// request stays valid, and log a warning so the cause can be investigated.
// -------------------------------------------------------------------------

function sanitizeContentsForGemini(
  contents: Content[],
  context: { previousResponseId?: string },
): Content[] {
  const result: Content[] = [];
  let repairs = 0;
  let sentinels = 0;

  for (let i = 0; i < contents.length; i += 1) {
    const current = contents[i];
    if (!current) continue;

    if (current.role === "model" && current.parts) {
      const calls = current.parts.filter((p) => p.functionCall);
      if (calls.length > 0) {
        const first = calls[0]!;
        if (!first.thoughtSignature) {
          first.thoughtSignature = SKIP_SIGNATURE_SENTINEL;
          sentinels += 1;
        }
      }
      result.push(current);

      if (calls.length === 0) continue;

      const next = contents[i + 1];
      // Consume one response per call: by id when Gemini issued ids, else by
      // name (two parallel calls to the same tool need two responses).
      const unclaimed =
        next && next.role === "user" && next.parts
          ? next.parts.filter((p) => p.functionResponse)
          : [];
      const missing = calls.filter((c) => {
        const fc = c.functionCall!;
        const idx = unclaimed.findIndex((p) =>
          fc.id ? p.functionResponse?.id === fc.id : p.functionResponse?.name === fc.name,
        );
        if (idx < 0) return true;
        unclaimed.splice(idx, 1);
        return false;
      });
      if (missing.length === 0) continue;

      repairs += missing.length;
      const synthetic: Part[] = missing.map((c) => ({
        functionResponse: {
          name: c.functionCall?.name ?? "unknown",
          ...(c.functionCall?.id ? { id: c.functionCall.id } : {}),
          response: {
            error:
              "Tool result missing from the recorded conversation; synthesized to keep the protocol valid.",
          },
        },
      }));
      if (next && next.role === "user") {
        result.push({ role: "user", parts: [...synthetic, ...(next.parts ?? [])] });
        i += 1;
      } else {
        result.push({ role: "user", parts: synthetic });
      }
      continue;
    }

    result.push(current);
  }

  if (repairs > 0 || sentinels > 0) {
    logger.warn(
      {
        repairs,
        sentinels,
        previousResponseId: context.previousResponseId,
        roles: result.map((c) => c.role),
      },
      "Gemini client repaired the conversation (synthetic functionResponse parts and/or sentinel thought signatures)",
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

function messageContentToParts(content: unknown, role: "user" | "model"): Part[] {
  if (typeof content === "string") {
    return content ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts: Part[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as { type?: string; text?: string; image_url?: string; refusal?: string };
    if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
      if (p.text) parts.push({ text: p.text });
      continue;
    }
    if (p.type === "refusal") {
      parts.push({ text: `[refusal] ${p.refusal ?? ""}` });
      continue;
    }
    if (p.type === "input_image" && role === "user" && typeof p.image_url === "string") {
      parts.push(imagePartFromUrl(p.image_url));
      continue;
    }
  }
  return parts;
}

/**
 * Inline `data:` URLs become `inlineData` blobs. Remote URLs are not fetched
 * by the Gemini API for arbitrary hosts, so they degrade to a text reference.
 */
function imagePartFromUrl(url: string): Part {
  const m = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (m) {
    const [, mimeType, data] = m;
    return { inlineData: { mimeType: mimeType!, data: data! } };
  }
  return { text: `[image] ${url}` };
}

/**
 * Tool outputs are strings (usually JSON) in this codebase. Gemini expects a
 * JSON object; we wrap under the documented `output` key, parsing JSON text
 * so the model sees structure rather than an escaped string.
 */
function toolOutputToResponse(output: unknown): Record<string, unknown> {
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return { output: JSON.parse(trimmed) as unknown };
      } catch {
        // fall through to the raw string
      }
    }
    return { output };
  }
  if (Array.isArray(output)) {
    const texts: string[] = [];
    for (const part of output) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; text?: string };
      if (p.type === "input_text" || p.type === "output_text" || p.type === "text") {
        if (p.text) texts.push(p.text);
      }
    }
    return { output: texts.join("\n") };
  }
  if (output == null) return { output: "" };
  return { output };
}

// -------------------------------------------------------------------------
// Tools translation: OpenAI FunctionTool → Gemini functionDeclarations.
// -------------------------------------------------------------------------

function translateTools(tools: FunctionTool[] | undefined): GeminiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    // `parametersJsonSchema` accepts standard JSON Schema (including
    // additionalProperties / nullable type arrays), unlike the legacy
    // OpenAPI-subset `parameters` field.
    parametersJsonSchema: t.parameters ?? { type: "object", properties: {} },
  }));
  return [{ functionDeclarations }];
}

/**
 * `auto` (and unset) leave the API default in place — AUTO, or VALIDATED
 * when structured output is also enabled — so we only emit a config for the
 * constraining choices. Gemini has no switch for disabling parallel calls;
 * `parallelToolCalls` is therefore ignored (the loops handle N calls anyway).
 */
function translateToolChoice(
  toolChoice: ResponseCreateParamsNonStreaming["tool_choice"] | undefined,
): ToolConfig | undefined {
  if (toolChoice === undefined || toolChoice === "auto") return undefined;
  if (toolChoice === "required") {
    return { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } };
  }
  if (toolChoice === "none") {
    return { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } };
  }
  if (
    typeof toolChoice === "object" &&
    toolChoice &&
    (toolChoice as { type?: string }).type === "function"
  ) {
    const name = (toolChoice as { name?: string }).name;
    if (name) {
      return {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: [name],
        },
      };
    }
  }
  return undefined;
}

// -------------------------------------------------------------------------
// Response translation: Gemini GenerateContentResponse → OpenAI Response.
// -------------------------------------------------------------------------

function translateGenerateContentResponse(
  gcr: GenerateContentResponse,
  responseId: string,
  model: string,
): { response: Response; modelContent: Content | null; callNames: Map<string, string> } {
  const candidate = gcr.candidates?.[0];
  const parts: Part[] = candidate?.content?.parts ?? [];
  const output: ResponseOutputItem[] = [];
  const callNames = new Map<string, string>();

  // Aggregate consecutive text parts into one message item, keeping the
  // signature of the last part so it can be replayed on that message.
  let textBuffer: { text: string; signature?: string }[] = [];
  let messageIndex = 0;
  const flushText = () => {
    if (textBuffer.length === 0) return;
    const msg: GeminiTaggedMessage = {
      id: `gemini_message_${responseId}_${messageIndex}`,
      type: "message",
      role: "assistant",
      status: "completed",
      content: textBuffer.map((t) => ({ type: "output_text", text: t.text, annotations: [] })),
    };
    const lastSigned = [...textBuffer].reverse().find((t) => t.signature);
    if (lastSigned?.signature) msg.__geminiThoughtSignature = lastSigned.signature;
    output.push(msg);
    messageIndex += 1;
    textBuffer = [];
  };

  let callIndex = 0;
  // The Content we echo back into the state cache: Gemini's parts verbatim,
  // minus unsigned thought summaries (which only cost input tokens).
  const echoParts: Part[] = [];

  for (const part of parts) {
    if (part.thought) {
      flushText();
      const text = part.text ?? "";
      const item: GeminiTaggedReasoning = {
        id: `gemini_thought_${responseId}_${output.length}`,
        type: "reasoning",
        summary: text ? [{ type: "summary_text", text }] : [],
        content: text ? [{ type: "reasoning_text", text }] : [],
      };
      if (part.thoughtSignature) {
        item.__geminiThoughtSignature = part.thoughtSignature;
        echoParts.push(part);
      }
      output.push(item);
      continue;
    }
    if (part.functionCall) {
      flushText();
      const fc = part.functionCall;
      const callId =
        fc.id && fc.id.length > 0
          ? fc.id
          : `${SYNTHETIC_CALL_PREFIX}${responseId}_${callIndex}`;
      callIndex += 1;
      const name = fc.name ?? "";
      callNames.set(callId, name);
      const call: GeminiTaggedFunctionCall = {
        type: "function_call",
        call_id: callId,
        name,
        arguments: JSON.stringify(fc.args ?? {}),
        id: callId,
      };
      if (part.thoughtSignature) call.__geminiThoughtSignature = part.thoughtSignature;
      output.push(call as ResponseOutputItem);
      echoParts.push(part);
      continue;
    }
    if (typeof part.text === "string") {
      if (part.text.length > 0 || part.thoughtSignature) {
        textBuffer.push({
          text: part.text,
          ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
        });
        echoParts.push(part);
      }
      continue;
    }
    // Other part kinds (executableCode, inlineData, ...) are not requested by
    // this codebase; drop silently.
  }
  flushText();

  const finishReason = candidate?.finishReason;
  const truncated = finishReason === FinishReason.MAX_TOKENS;
  if (!candidate) {
    logger.warn(
      { blockReason: gcr.promptFeedback?.blockReason, model },
      "Gemini returned no candidates",
    );
  } else if (finishReason && finishReason !== FinishReason.STOP && !truncated) {
    logger.warn({ finishReason, model }, "Gemini stopped generation early");
  }

  const aggregateText = output
    .filter(isMessage)
    .map((m) => extractAssistantText(m))
    .join("");

  // Map Gemini usage into the OpenAI Responses `usage` shape. Gemini bills
  // thinking at the output rate and reports it separately, so fold thoughts
  // into output_tokens (mirroring OpenAI, where reasoning ⊂ output) and keep
  // the count in reasoning_tokens; cached prompt tokens are already included
  // in promptTokenCount, matching OpenAI's "cached ⊂ input".
  const u = gcr.usageMetadata;
  const inputTokens = (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0);
  const cachedInput = u?.cachedContentTokenCount ?? 0;
  const reasoningTokens = u?.thoughtsTokenCount ?? 0;
  const outputTokens = (u?.candidatesTokenCount ?? 0) + reasoningTokens;

  const response = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: truncated ? "incomplete" : "completed",
    output,
    output_text: aggregateText,
    error: null,
    incomplete_details: truncated ? { reason: "max_output_tokens" } : null,
    instructions: null,
    metadata: null,
    model: gcr.modelVersion ?? model,
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
      total_tokens: u?.totalTokenCount ?? inputTokens + outputTokens,
    },
  } as unknown as Response;

  return {
    response,
    modelContent: echoParts.length > 0 ? { role: "model", parts: echoParts } : null,
    callNames,
  };
}

// -------------------------------------------------------------------------
// createResponse – Gemini implementation.
// -------------------------------------------------------------------------

function mergeSystem(
  instructions: string | undefined,
  systemFromInput: string | undefined,
): string | undefined {
  const chunks: string[] = [];
  if (instructions) chunks.push(instructions);
  if (systemFromInput) chunks.push(systemFromInput);
  return chunks.length > 0 ? chunks.join("\n\n") : undefined;
}

function translateResponseFormat(
  rf: JsonSchemaResponseFormat | undefined,
): Pick<GenerateContentConfig, "responseMimeType" | "responseJsonSchema"> {
  if (!rf) return {};
  return { responseMimeType: "application/json", responseJsonSchema: rf.schema };
}

/**
 * Older Gemini models reject a JSON response schema combined with function
 * declarations. Detect that specific 400 so the call can be retried once
 * without the schema (the callers parse the final message leniently).
 */
function isSchemaWithToolsRejection(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { status?: number }).status !== 400) return false;
  const message = String((err as { message?: unknown }).message ?? "");
  return (
    /function.?call/i.test(message) &&
    /(response.?(mime|schema|format)|structured.?output|json)/i.test(message)
  );
}

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
      `geminiClient: unknown previousResponseId '${options.previousResponseId}'. ` +
        "The Gemini provider keeps conversation state in-process; the cache may have been evicted.",
    );
  }

  const callNames = new Map<string, string>(prior?.callNames ?? []);
  const translatedNew = translateInputItems(newItems, callNames);
  const rawContents: Content[] = prior
    ? [...prior.contents, ...translatedNew.contents]
    : translatedNew.contents;
  const contents = sanitizeContentsForGemini(rawContents, {
    ...(options.previousResponseId !== undefined
      ? { previousResponseId: options.previousResponseId }
      : {}),
  });
  const system = mergeSystem(options.instructions, translatedNew.system);

  const thinkingLevel = toThinkingLevel(
    (options.reasoning?.effort ?? undefined) as ReasoningEffort | undefined,
  );
  const tools = translateTools(options.tools);
  const toolConfig = translateToolChoice(options.toolChoice);
  const responseFormat = translateResponseFormat(options.responseFormat);

  const baseConfig: GenerateContentConfig = {
    ...(system ? { systemInstruction: system } : {}),
    ...(tools ? { tools } : {}),
    ...(toolConfig ? { toolConfig } : {}),
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    thinkingConfig: {
      includeThoughts: true,
      ...(thinkingLevel ? { thinkingLevel } : {}),
    },
    ...(options.signal ? { abortSignal: options.signal } : {}),
  };

  let includeSchema = options.responseFormat !== undefined;
  let attempt = 0;
  let lastError: unknown;
  while (attempt < DEFAULT_RETRIES) {
    attempt += 1;
    if (options.signal?.aborted) {
      throw new AbortError("Aborted before Gemini generateContent call");
    }
    const config: GenerateContentConfig = {
      ...baseConfig,
      ...(includeSchema ? responseFormat : {}),
    };
    try {
      const gcr = await gemini.models.generateContent({
        model: options.model,
        contents,
        config,
      });
      const responseId =
        gcr.responseId && gcr.responseId.length > 0
          ? `gemini_${gcr.responseId}`
          : `gemini_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const { response, modelContent, callNames: newNames } =
        translateGenerateContentResponse(gcr, responseId, options.model);
      for (const [id, name] of newNames) callNames.set(id, name);
      rememberConversation(
        responseId,
        modelContent ? [...contents, modelContent] : [...contents],
        callNames,
      );
      if (options.previousResponseId !== undefined) {
        forgetConversation(options.previousResponseId);
      }
      return response;
    } catch (err) {
      lastError = err;
      if (isAbort(err)) throw err;
      if (includeSchema && tools && isSchemaWithToolsRejection(err)) {
        // Retry immediately without the schema; does not consume a retry.
        includeSchema = false;
        attempt -= 1;
        logger.warn(
          { model: options.model },
          "Gemini rejected responseJsonSchema alongside function declarations; retrying without the schema",
        );
        continue;
      }
      const status = (err as { status?: number }).status;
      const isRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);
      if (!isRetryable || attempt >= DEFAULT_RETRIES) {
        throw err;
      }
      const delayMs = 250 * Math.pow(2, attempt - 1);
      logger.warn({ attempt, status, delayMs }, "Gemini generateContent call failed, retrying");
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// -------------------------------------------------------------------------
// Generic agent loops — identical control flow to openaiClient, with the
// only difference being that createResponse is the Gemini-backed one above.
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
// single module if they pick the Gemini provider.
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
