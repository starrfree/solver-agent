/**
 * Client audit suite.
 *
 * Goal: prove (with captured runtime payloads) that the Claude, HuggingFace and
 * Gemini clients correctly translate our provider-agnostic Responses-shaped input
 * (system/developer instructions, ledger context, conversation, reasoning,
 * tool calls + outputs) into the wire request each provider actually receives,
 * across single calls AND multi-turn agent loops, and that the response usage
 * is mapped back faithfully for the cost ledger.
 *
 * The transport layer of each SDK is monkey-patched so we capture the EXACT
 * request body the client built, without any network access or API keys.
 *
 * Run: `npm test` (from backend/), i.e. `tsx --test src/agents/__tests__/clientAudit.test.ts`.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import type { ResponseInputItem } from "openai/resources/responses/responses";

import { anthropic } from "../claudeClient";
import * as claudeClient from "../claudeClient";
import { gemini } from "../geminiClient";
import * as geminiClient from "../geminiClient";
import { hf } from "../hfClient";
import * as hfClient from "../hfClient";
import * as llmClient from "../llmClient";
import { openai } from "../openaiClient";
import { MAIN_SOLVER_PROMPT } from "../systemPrompts";
import { mainSolverTools } from "../toolSchemas";
import { stepVerificationSchema } from "../toolSchemas";
import { usageRepo } from "../../repositories/usageRepo";
import { runWithUsageContext } from "../usageContext";
import { computeCostUsd, pricingFor } from "../../config/pricing";

// -------------------------------------------------------------------------
// Test problem + realistic fixtures (mirrors mainSolverAgent.buildInitialInput).
// -------------------------------------------------------------------------

const PROBLEM = "Find all real solutions to x^3 - 6x^2 + 11x - 6 = 0.";

/** Mimics mainSolverAgent.buildLedgerContextBlock output closely enough to
 * audit that ledger entries are delivered verbatim into the model prompt. */
const LEDGER_CONTEXT = [
  `Conversation id: conv-test-1`,
  `Generated files for this conversation are served at /api/conversations/conv-test-1/files/<fileId>.`,
  ``,
  `Problem statement:\n${PROBLEM}`,
  ``,
  `Recent ledger entries (2 of 2):`,
  `[entry-1] type=assumption status=accepted tool=main_solver dependsOn=[(none)] :: Treat the cubic as a polynomial over the reals and search for rational roots.`,
  `[entry-2] type=derivation status=accepted tool=main_solver dependsOn=[entry-1] :: By the rational-root theorem candidate roots are divisors of 6: {1,2,3,6}.`,
].join("\n");

/** A developer message carrying the ledger context, followed by the user turn. */
function buildSolverInput(): ResponseInputItem[] {
  return [
    { type: "message", role: "developer", content: LEDGER_CONTEXT } as ResponseInputItem,
    { type: "message", role: "user", content: PROBLEM } as ResponseInputItem,
  ];
}

// -------------------------------------------------------------------------
// No-live-network guard.
//
// Every provider transport is replaced with a thrower at module load, so a
// PROVIDER_MATRIX change can never silently route a test at a real API (and
// bill the key from .env). The mock installers below override these stubs
// and restore back to them, keeping the guard in force for the whole run.
// -------------------------------------------------------------------------

(openai.responses as any).create = async () => {
  throw new Error(
    "Test attempted a LIVE OpenAI Responses call — install an OpenAI mock (installOpenAiMock) for this code path.",
  );
};
(anthropic.messages as any).stream = () => {
  throw new Error(
    "Test attempted a LIVE Anthropic call — install a Claude mock (installClaudeMock) for this code path.",
  );
};
(hf.chat.completions as any).create = async () => {
  throw new Error(
    "Test attempted a LIVE HuggingFace call — install an HF mock (installHfMock) for this code path.",
  );
};
(gemini.models as any).generateContent = async () => {
  throw new Error(
    "Test attempted a LIVE Gemini call — install a Gemini mock (installGeminiMock) for this code path.",
  );
};

// -------------------------------------------------------------------------
// SDK transport capture harnesses.
// -------------------------------------------------------------------------

interface ClaudeHarness {
  bodies: any[];
  restore: () => void;
}

/** Patch `anthropic.messages.stream` to capture each request body and return
 * the next scripted Anthropic Message from `script`. */
function installClaudeMock(script: any[]): ClaudeHarness {
  const bodies: any[] = [];
  const queue = [...script];
  const original = (anthropic.messages as any).stream;
  (anthropic.messages as any).stream = (body: any) => {
    bodies.push(body);
    const msg = queue.shift();
    return { finalMessage: async () => msg };
  };
  return {
    bodies,
    restore: () => {
      (anthropic.messages as any).stream = original;
    },
  };
}

interface OpenAiHarness {
  bodies: any[];
  restore: () => void;
}

/** Patch `openai.responses.create` to capture each request body and return
 * the next scripted Responses API payload from `script`. */
function installOpenAiMock(script: any[]): OpenAiHarness {
  const bodies: any[] = [];
  const queue = [...script];
  const original = (openai.responses as any).create;
  (openai.responses as any).create = async (body: any) => {
    bodies.push(body);
    return queue.shift();
  };
  return {
    bodies,
    restore: () => {
      (openai.responses as any).create = original;
    },
  };
}

interface HfHarness {
  bodies: any[];
  restore: () => void;
}

function installHfMock(script: any[]): HfHarness {
  const bodies: any[] = [];
  const queue = [...script];
  const original = (hf.chat.completions as any).create;
  (hf.chat.completions as any).create = async (body: any) => {
    bodies.push(body);
    return queue.shift();
  };
  return {
    bodies,
    restore: () => {
      (hf.chat.completions as any).create = original;
    },
  };
}

interface GeminiHarness {
  /** Captured `generateContent` params: `{ model, contents, config }`. */
  bodies: any[];
  restore: () => void;
}

/** Patch `gemini.models.generateContent` to capture each request and return
 * the next scripted `GenerateContentResponse` (or throw a scripted error). */
function installGeminiMock(script: any[]): GeminiHarness {
  const bodies: any[] = [];
  const queue = [...script];
  const original = (gemini.models as any).generateContent;
  (gemini.models as any).generateContent = async (params: any) => {
    // Deep-copy so later in-place mutations by the client (sanitizer, cache)
    // cannot retroactively alter what we assert was sent on the wire.
    bodies.push(JSON.parse(JSON.stringify(params)));
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    bodies,
    restore: () => {
      (gemini.models as any).generateContent = original;
    },
  };
}

// --- Scripted provider responses -----------------------------------------

function claudeMessage(opts: {
  id?: string;
  content: any[];
  usage?: any;
}): any {
  return {
    id: opts.id ?? "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: opts.content,
    usage:
      opts.usage ??
      { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 50 },
  };
}

function openaiResponse(opts: {
  id?: string;
  text?: string;
  model?: string;
  usage?: any;
}): any {
  const text = opts.text ?? "ok";
  return {
    id: opts.id ?? "resp_test",
    object: "response",
    created_at: 1_700_000_000,
    status: "completed",
    model: opts.model ?? "gpt-5.6-luna",
    output: [
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    output_text: text,
    error: null,
    incomplete_details: null,
    usage:
      opts.usage ??
      {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 20 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 30 },
        total_tokens: 150,
      },
  };
}

function hfCompletion(opts: {
  id?: string;
  content?: string | null;
  reasoningContent?: string;
  toolCalls?: any[];
  usage?: any;
}): any {
  return {
    id: opts.id ?? "chatcmpl_test",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "zai-org/GLM-5.2",
    choices: [
      {
        index: 0,
        finish_reason: opts.toolCalls ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: opts.content ?? null,
          ...(opts.reasoningContent ? { reasoning_content: opts.reasoningContent } : {}),
          ...(opts.toolCalls ? { tool_calls: opts.toolCalls } : {}),
        },
      },
    ],
    usage:
      opts.usage ??
      {
        prompt_tokens: 100,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 30 },
        total_tokens: 150,
      },
  };
}

function geminiResponse(opts: {
  id?: string;
  parts: any[];
  usage?: any;
  finishReason?: string;
  model?: string;
}): any {
  return {
    responseId: opts.id ?? "gresp_test",
    modelVersion: opts.model ?? "gemini-3.8-flash",
    candidates: [
      {
        index: 0,
        finishReason: opts.finishReason ?? "STOP",
        content: { role: "model", parts: opts.parts },
      },
    ],
    usageMetadata:
      opts.usage ??
      {
        promptTokenCount: 100,
        cachedContentTokenCount: 20,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 20,
        totalTokenCount: 150,
      },
  };
}

/** Flatten every part of every content in a captured Gemini request. */
function geminiParts(body: any): any[] {
  return (body.contents as any[]).flatMap((c: any) => c.parts ?? []);
}

// =========================================================================
// CLAUDE CLIENT
// =========================================================================

describe("Claude client — request translation", () => {
  let h: ClaudeHarness;
  afterEach(() => h?.restore());

  test("system = instructions + developer ledger context (in order); user stays a message", async () => {
    h = installClaudeMock([claudeMessage({ content: [{ type: "text", text: "ok" }] })]);

    await claudeClient.createResponse({
      model: "claude-sonnet-4-6",
      instructions: MAIN_SOLVER_PROMPT,
      input: buildSolverInput(),
      tools: mainSolverTools,
      toolChoice: "auto",
      parallelToolCalls: false,
      reasoning: { effort: "max" },
      maxOutputTokens: 32_000,
      promptCacheKey: "main-solver:conv-test-1",
    });

    const body = h.bodies[0];
    // instructions first, then ledger context, joined by a blank line.
    assert.equal(body.system, `${MAIN_SOLVER_PROMPT}\n\n${LEDGER_CONTEXT}`);
    // ledger entries delivered verbatim into the model prompt.
    assert.ok(body.system.includes("[entry-1] type=assumption"));
    assert.ok(body.system.includes("[entry-2] type=derivation"));
    assert.ok(body.system.includes(PROBLEM));
    // user problem statement is a user message, NOT folded into system.
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, "user");
    assert.deepEqual(body.messages[0].content, [{ type: "text", text: PROBLEM }]);
  });

  test("tools, tool_choice (parallel disabled), thinking, effort, max_tokens, cache key", async () => {
    h = installClaudeMock([claudeMessage({ content: [{ type: "text", text: "ok" }] })]);

    await claudeClient.createResponse({
      model: "claude-sonnet-4-6",
      instructions: "sys",
      input: PROBLEM,
      tools: mainSolverTools,
      toolChoice: "auto",
      parallelToolCalls: false,
      reasoning: { effort: "max" },
      maxOutputTokens: 12_345,
      promptCacheKey: "ck-1",
    });

    const body = h.bodies[0];
    // every function tool is translated to {name, description, input_schema}
    assert.equal(body.tools.length, mainSolverTools.length);
    const ledgerTool = body.tools.find((t: any) => t.name === "ledger_append_entry");
    assert.ok(ledgerTool, "ledger_append_entry tool present");
    assert.ok(ledgerTool.input_schema && ledgerTool.input_schema.type === "object");
    assert.ok(typeof ledgerTool.description === "string" && ledgerTool.description.length > 0);
    // parallelToolCalls=false → disable_parallel_tool_use on an auto choice
    assert.deepEqual(body.tool_choice, { type: "auto", disable_parallel_tool_use: true });
    // adaptive thinking always on
    assert.deepEqual(body.thinking, { type: "adaptive" });
    // "max" effort surfaces in output_config
    assert.equal(body.output_config.effort, "max");
    assert.equal(body.max_tokens, 12_345);
    // prompt cache key maps to metadata.user_id
    assert.deepEqual(body.metadata, { user_id: "ck-1" });
  });

  test("effort axis maps correctly (high/medium/low/xhigh/max; none omitted)", async () => {
    for (const [effort, expected] of [
      ["high", "high"],
      ["medium", "medium"],
      ["low", "low"],
      ["minimal", "low"],
      ["xhigh", "xhigh"],
      ["max", "max"],
    ] as const) {
      const hh = installClaudeMock([claudeMessage({ content: [{ type: "text", text: "ok" }] })]);
      await claudeClient.createResponse({
        model: "claude-sonnet-4-6",
        input: "hi",
        reasoning: { effort: effort as any },
      });
      assert.equal(hh.bodies[0].output_config?.effort, expected, `effort ${effort}`);
      hh.restore();
    }
    // "none" → no output_config (thinking stays default)
    const hn = installClaudeMock([claudeMessage({ content: [{ type: "text", text: "ok" }] })]);
    await claudeClient.createResponse({
      model: "claude-sonnet-4-6",
      input: "hi",
      reasoning: { effort: "none" as any },
    });
    assert.equal(hn.bodies[0].output_config, undefined);
    hn.restore();
  });

  test("reasoning round-trips: signed thinking preserved, redacted preserved, unsigned dropped", async () => {
    h = installClaudeMock([claudeMessage({ content: [{ type: "text", text: "ok" }] })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: "solve it" } as ResponseInputItem,
      // signed reasoning (came from a prior Claude turn)
      {
        id: "r1",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "summary text" }],
        content: [{ type: "reasoning_text", text: "deep thought" }],
        __claudeSignature: "sig-XYZ",
      } as any,
      // redacted reasoning
      { id: "r2", type: "reasoning", summary: [], content: [], __claudeRedactedData: "REDACTED==" } as any,
      // unsigned reasoning (foreign provider) — must be dropped
      {
        id: "r3",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "foreign" }],
        content: [{ type: "reasoning_text", text: "foreign" }],
      } as any,
    ];

    await claudeClient.createResponse({ model: "claude-sonnet-4-6", input });

    const blocks = h.bodies[0].messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
    const thinking = blocks.find((b: any) => b.type === "thinking");
    assert.ok(thinking, "signed thinking block present");
    assert.equal(thinking.signature, "sig-XYZ");
    assert.equal(thinking.thinking, "deep thought");
    const redacted = blocks.find((b: any) => b.type === "redacted_thinking");
    assert.ok(redacted, "redacted_thinking block present");
    assert.equal(redacted.data, "REDACTED==");
    // only ONE thinking block (the unsigned one is dropped)
    assert.equal(blocks.filter((b: any) => b.type === "thinking").length, 1);
  });

  test("tool_use / tool_result adjacency is preserved", async () => {
    h = installClaudeMock([claudeMessage({ content: [{ type: "text", text: "done" }] })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: PROBLEM } as ResponseInputItem,
      { type: "function_call", call_id: "toolu_1", name: "ledger_append_entry", arguments: '{"x":1}' } as any,
      { type: "function_call_output", call_id: "toolu_1", output: '{"ok":true,"entryId":"e9"}' } as any,
    ];

    await claudeClient.createResponse({ model: "claude-sonnet-4-6", input, tools: mainSolverTools });

    const msgs = h.bodies[0].messages;
    // user, assistant(tool_use), user(tool_result)
    const assistant = msgs.find((m: any) => m.role === "assistant");
    const toolUse = assistant.content.find((b: any) => b.type === "tool_use");
    assert.equal(toolUse.id, "toolu_1");
    assert.equal(toolUse.name, "ledger_append_entry");
    assert.deepEqual(toolUse.input, { x: 1 });
    // the message immediately AFTER the assistant tool_use is a user tool_result for the same id
    const idx = msgs.indexOf(assistant);
    const after = msgs[idx + 1];
    assert.equal(after.role, "user");
    const toolResult = after.content.find((b: any) => b.type === "tool_result");
    assert.equal(toolResult.tool_use_id, "toolu_1");
  });

  test("sanitizer synthesizes a tool_result for an orphan tool_use", async () => {
    h = installClaudeMock([claudeMessage({ content: [{ type: "text", text: "done" }] })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: PROBLEM } as ResponseInputItem,
      { type: "function_call", call_id: "orphan_1", name: "symbolic_compute", arguments: "{}" } as any,
      // NO matching function_call_output → must be synthesized
      { type: "message", role: "user", content: "carry on" } as ResponseInputItem,
    ];

    await claudeClient.createResponse({ model: "claude-sonnet-4-6", input, tools: mainSolverTools });

    const msgs = h.bodies[0].messages;
    const allBlocks = msgs.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
    const synthetic = allBlocks.find(
      (b: any) => b.type === "tool_result" && b.tool_use_id === "orphan_1",
    );
    assert.ok(synthetic, "synthetic tool_result inserted for orphan tool_use");
    assert.equal(synthetic.is_error, true);
  });

  test("response → Response: usage folds cache reads back into input_tokens", async () => {
    h = installClaudeMock([
      claudeMessage({
        id: "msg_usage",
        content: [
          { type: "thinking", thinking: "t", signature: "s1" },
          { type: "text", text: "answer" },
          { type: "tool_use", id: "tu1", name: "symbolic_compute", input: { task: "x" } },
        ],
        usage: { input_tokens: 80, cache_read_input_tokens: 20, output_tokens: 40 },
      }),
    ]);

    const res = await claudeClient.createResponse({ model: "claude-sonnet-4-6", input: "go" });
    const u: any = res.usage;

    // input_tokens includes cache reads (80 + 20); cached subset = 20
    assert.equal(u.input_tokens, 100);
    assert.equal(u.input_tokens_details.cached_tokens, 20);
    assert.equal(u.output_tokens, 40);
    assert.equal(u.total_tokens, 140);
    // output items: reasoning + function_call + message
    const types = res.output.map((o: any) => o.type);
    assert.ok(types.includes("reasoning"));
    assert.ok(types.includes("function_call"));
    assert.ok(types.includes("message"));
  });

  test("previous_response_id: unknown id throws; known id prepends prior turn", async () => {
    // unknown id
    const hu = installClaudeMock([claudeMessage({ content: [{ type: "text", text: "x" }] })]);
    await assert.rejects(
      () => claudeClient.createResponse({ model: "claude-sonnet-4-6", input: "hi", previousResponseId: "does-not-exist" }),
      /unknown previousResponseId/,
    );
    hu.restore();

    // known id: first call seeds the cache, second call must replay prior history
    const h2 = installClaudeMock([
      claudeMessage({ id: "first", content: [{ type: "text", text: "first answer" }] }),
      claudeMessage({ id: "second", content: [{ type: "text", text: "second answer" }] }),
    ]);
    const r1 = await claudeClient.createResponse({
      model: "claude-sonnet-4-6",
      instructions: "sys",
      input: "first question",
    });
    await claudeClient.createResponse({
      model: "claude-sonnet-4-6",
      input: "second question",
      previousResponseId: r1.id,
    });
    const secondBody = h2.bodies[1];
    const userTexts = secondBody.messages
      .filter((m: any) => m.role === "user")
      .flatMap((m: any) => m.content)
      .map((b: any) => b.text);
    assert.ok(userTexts.includes("first question"), "prior user turn replayed");
    assert.ok(userTexts.includes("second question"), "new user turn appended");
    // the prior assistant answer is replayed too
    const assistantTexts = secondBody.messages
      .filter((m: any) => m.role === "assistant")
      .flatMap((m: any) => m.content)
      .map((b: any) => b.text);
    assert.ok(assistantTexts.includes("first answer"), "prior assistant turn replayed");
    h2.restore();
  });
});

// =========================================================================
// HUGGINGFACE CLIENT
// =========================================================================

describe("HuggingFace client — request translation", () => {
  let h: HfHarness;
  afterEach(() => h?.restore());

  test("system message at head carries instructions + ledger context; user kept", async () => {
    h = installHfMock([hfCompletion({ content: "ok" })]);

    await hfClient.createResponse({
      model: "zai-org/GLM-5.2:together",
      instructions: MAIN_SOLVER_PROMPT,
      input: buildSolverInput(),
      tools: mainSolverTools,
      toolChoice: "auto",
      parallelToolCalls: false,
      reasoning: { effort: "max" },
      maxOutputTokens: 32_000,
      promptCacheKey: "main-solver:conv-test-1",
    });

    const body = h.bodies[0];
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, `${MAIN_SOLVER_PROMPT}\n\n${LEDGER_CONTEXT}`);
    assert.ok(body.messages[0].content.includes("[entry-1] type=assumption"));
    assert.ok(body.messages[0].content.includes("[entry-2] type=derivation"));
    const userMsg = body.messages.find((m: any) => m.role === "user");
    assert.equal(userMsg.content, PROBLEM);
  });

  test("model, max_completion_tokens, reasoning_effort, user, parallel_tool_calls, tools(strict)", async () => {
    h = installHfMock([hfCompletion({ content: "ok" })]);

    await hfClient.createResponse({
      model: "zai-org/GLM-5.2:together",
      input: PROBLEM,
      tools: mainSolverTools,
      toolChoice: "auto",
      parallelToolCalls: false,
      reasoning: { effort: "max" },
      maxOutputTokens: 9_999,
      promptCacheKey: "ck-hf",
    });

    const body = h.bodies[0];
    assert.equal(body.model, "zai-org/GLM-5.2:together");
    assert.equal(body.max_completion_tokens, 9_999);
    assert.equal(body.reasoning_effort, "max");
    assert.equal(body.user, "ck-hf");
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.tools.length, mainSolverTools.length);
    const lt = body.tools.find((t: any) => t.function.name === "ledger_append_entry");
    assert.equal(lt.type, "function");
    assert.equal(lt.function.strict, true);
    assert.ok(lt.function.parameters.type === "object");
    assert.equal(body.tool_choice, "auto");
  });

  test("response_format json_schema is forwarded", async () => {
    h = installHfMock([hfCompletion({ content: '{"verdict":"accepted"}' })]);

    await hfClient.createResponse({
      model: "zai-org/GLM-5.2:together",
      input: "verify this step",
      responseFormat: stepVerificationSchema as any,
    });

    const rf = h.bodies[0].response_format;
    assert.equal(rf.type, "json_schema");
    assert.equal(rf.json_schema.name, "step_verification_verdict");
    assert.equal(rf.json_schema.strict, true);
    assert.ok(rf.json_schema.schema.type === "object");
  });

  test("function_call → assistant tool_calls; output → tool message; reasoning dropped", async () => {
    h = installHfMock([hfCompletion({ content: "done" })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: PROBLEM } as ResponseInputItem,
      // a reasoning item that must be dropped (chat models reject them)
      { id: "rr", type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "x" }] } as any,
      { type: "function_call", call_id: "call_1", name: "numerical_compute", arguments: '{"task":"t"}' } as any,
      { type: "function_call_output", call_id: "call_1", output: '{"ok":true}' } as any,
    ];

    await hfClient.createResponse({ model: "zai-org/GLM-5.2:together", input, tools: mainSolverTools });

    const msgs = h.bodies[0].messages;
    assert.ok(!msgs.some((m: any) => m.role === "reasoning"), "no reasoning role leaked");
    const asst = msgs.find((m: any) => m.role === "assistant" && Array.isArray(m.tool_calls));
    assert.equal(asst.tool_calls[0].id, "call_1");
    assert.equal(asst.tool_calls[0].function.name, "numerical_compute");
    // tool message answering call_1 immediately follows
    const idx = msgs.indexOf(asst);
    assert.equal(msgs[idx + 1].role, "tool");
    assert.equal(msgs[idx + 1].tool_call_id, "call_1");
  });

  test("sanitizer reorders/synthesizes tool messages to satisfy adjacency", async () => {
    h = installHfMock([hfCompletion({ content: "done" })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: PROBLEM } as ResponseInputItem,
      { type: "function_call", call_id: "c1", name: "symbolic_compute", arguments: "{}" } as any,
      { type: "function_call", call_id: "c2", name: "numerical_compute", arguments: "{}" } as any,
      // only c2 answered, and out of order; c1 must be synthesized
      { type: "function_call_output", call_id: "c2", output: "result-2" } as any,
    ];

    await hfClient.createResponse({ model: "zai-org/GLM-5.2:together", input, tools: mainSolverTools });

    const msgs = h.bodies[0].messages;
    const asst = msgs.find((m: any) => m.role === "assistant" && Array.isArray(m.tool_calls));
    const idx = msgs.indexOf(asst);
    // assistant carries both tool_calls, followed by two tool messages (c1 synth, c2 real)
    const toolMsgs = [msgs[idx + 1], msgs[idx + 2]];
    const ids = toolMsgs.map((m: any) => m.tool_call_id).sort();
    assert.deepEqual(ids, ["c1", "c2"]);
  });

  test("reasoning_content round-trips: captured as a tagged reasoning item and echoed back on the tool-calling turn", async () => {
    // Turn 1: the model thinks, then calls a tool. Turn 2: it answers.
    h = installHfMock([
      hfCompletion({
        id: "t1",
        reasoningContent: "rational roots are 1, 2, 3; delegate the solve",
        toolCalls: [
          { id: "call_solve", type: "function", function: { name: "symbolic_compute", arguments: '{"task":"solve","dependsOn":[]}' } },
        ],
      }),
      hfCompletion({ id: "t2", content: "done" }),
    ]);

    const result = await hfClient.runManualAgentLoop({
      model: "deepseek-ai/DeepSeek-V4-Pro:together",
      instructions: "sys",
      input: [{ type: "message", role: "user", content: PROBLEM } as ResponseInputItem],
      tools: mainSolverTools,
      maxTurns: 5,
      handlers: { onToolCall: async () => '{"ok":true,"result":"x in {1,2,3}"}' },
    });

    // Turn 1 surfaced the reasoning as a tagged reasoning output item.
    const t1Reasoning = result.responses[0]!.output.find((o: any) => o.type === "reasoning") as any;
    assert.ok(t1Reasoning, "reasoning item emitted from the completion");
    assert.equal(t1Reasoning.__deepseekReasoning, "rational roots are 1, 2, 3; delegate the solve");

    // Turn 2's request must echo that reasoning_content back on the assistant
    // message that carries the tool_calls (DeepSeek's interleaved-reasoning contract).
    const t2 = h.bodies[1];
    const toolCallMsg = t2.messages.find(
      (m: any) => m.role === "assistant" && Array.isArray(m.tool_calls),
    );
    assert.ok(toolCallMsg, "assistant tool_calls message present on the follow-up request");
    assert.equal(toolCallMsg.tool_calls[0].id, "call_solve");
    assert.equal(
      toolCallMsg.reasoning_content,
      "rational roots are 1, 2, 3; delegate the solve",
      "reasoning_content echoed back on the tool-calling assistant message",
    );
    assert.ok(result.finalMessage);
    assert.equal(result.finalMessage!.content.map((c: any) => c.text ?? "").join(""), "done");
  });

  test("response → Response: usage maps prompt/cached/completion/reasoning tokens", async () => {
    h = installHfMock([
      hfCompletion({
        id: "cc_usage",
        content: "the answer",
        toolCalls: [
          { id: "call_x", type: "function", function: { name: "symbolic_compute", arguments: '{"task":"x"}' } },
        ],
        usage: {
          prompt_tokens: 200,
          prompt_tokens_details: { cached_tokens: 40 },
          completion_tokens: 90,
          completion_tokens_details: { reasoning_tokens: 25 },
          total_tokens: 290,
        },
      }),
    ]);

    const res = await hfClient.createResponse({ model: "zai-org/GLM-5.2:together", input: "go" });

    const u: any = res.usage;
    assert.equal(res.id, "cc_usage");
    assert.equal(u.input_tokens, 200);
    assert.equal(u.input_tokens_details.cached_tokens, 40);
    assert.equal(u.output_tokens, 90);
    assert.equal(u.output_tokens_details.reasoning_tokens, 25);
    assert.equal(u.total_tokens, 290);
    const types = res.output.map((o: any) => o.type);
    assert.ok(types.includes("function_call"));
    assert.ok(types.includes("message"));
  });

  test("previous_response_id: unknown throws; known replays history without re-injecting system", async () => {
    const hu = installHfMock([hfCompletion({ content: "x" })]);
    await assert.rejects(
      () => hfClient.createResponse({ model: "zai-org/GLM-5.2:together", input: "hi", previousResponseId: "nope" }),
      /unknown previousResponseId/,
    );
    hu.restore();

    const h2 = installHfMock([
      hfCompletion({ id: "first", content: "first answer" }),
      hfCompletion({ id: "second", content: "second answer" }),
    ]);
    const r1 = await hfClient.createResponse({
      model: "zai-org/GLM-5.2:together",
      instructions: "SYSTEM PROMPT",
      input: "first question",
    });
    await hfClient.createResponse({
      model: "zai-org/GLM-5.2:together",
      instructions: "SYSTEM PROMPT",
      input: "second question",
      previousResponseId: r1.id,
    });
    const second = h2.bodies[1].messages;
    // exactly ONE system message even though instructions were passed again
    assert.equal(second.filter((m: any) => m.role === "system").length, 1);
    const contents = second.map((m: any) => m.content);
    assert.ok(contents.includes("first question"));
    assert.ok(contents.includes("first answer"));
    assert.ok(contents.includes("second question"));
    h2.restore();
  });
});

// =========================================================================
// GEMINI CLIENT
// =========================================================================

describe("Gemini client — request translation", () => {
  let h: GeminiHarness;
  afterEach(() => h?.restore());

  test("systemInstruction = instructions + developer ledger context; user stays a user content", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: "ok" }] })]);

    await geminiClient.createResponse({
      model: "gemini-3.8-flash",
      instructions: MAIN_SOLVER_PROMPT,
      input: buildSolverInput(),
      tools: mainSolverTools,
      toolChoice: "auto",
      parallelToolCalls: false,
      reasoning: { effort: "max" },
      maxOutputTokens: 32_000,
      promptCacheKey: "main-solver:conv-test-1",
    });

    const body = h.bodies[0];
    assert.equal(body.model, "gemini-3.8-flash");
    assert.equal(body.config.systemInstruction, `${MAIN_SOLVER_PROMPT}\n\n${LEDGER_CONTEXT}`);
    assert.ok(body.config.systemInstruction.includes("[entry-1] type=assumption"));
    assert.ok(body.config.systemInstruction.includes("[entry-2] type=derivation"));
    // the user problem is a single user content with one text part
    assert.equal(body.contents.length, 1);
    assert.equal(body.contents[0].role, "user");
    assert.deepEqual(body.contents[0].parts, [{ text: PROBLEM }]);
  });

  test("tools → functionDeclarations(parametersJsonSchema); thinking; maxOutputTokens; auto choice leaves toolConfig unset", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: "ok" }] })]);

    await geminiClient.createResponse({
      model: "gemini-3.8-flash",
      instructions: "sys",
      input: PROBLEM,
      tools: mainSolverTools,
      toolChoice: "auto",
      parallelToolCalls: false,
      reasoning: { effort: "max" },
      maxOutputTokens: 12_345,
    });

    const cfg = h.bodies[0].config;
    assert.equal(cfg.tools.length, 1);
    const decls = cfg.tools[0].functionDeclarations;
    assert.equal(decls.length, mainSolverTools.length);
    const ledgerTool = decls.find((d: any) => d.name === "ledger_append_entry");
    assert.ok(ledgerTool, "ledger_append_entry declared");
    assert.ok(typeof ledgerTool.description === "string" && ledgerTool.description.length > 0);
    // strict JSON schema goes through parametersJsonSchema untouched
    assert.equal(ledgerTool.parametersJsonSchema.type, "object");
    assert.equal(ledgerTool.parametersJsonSchema.additionalProperties, false);
    assert.equal(ledgerTool.parameters, undefined);
    // `auto` → API default (AUTO / VALIDATED), so no toolConfig on the wire
    assert.equal(cfg.toolConfig, undefined);
    // thinking on, "max" collapses to HIGH
    assert.deepEqual(cfg.thinkingConfig, { includeThoughts: true, thinkingLevel: "HIGH" });
    assert.equal(cfg.maxOutputTokens, 12_345);
    // no structured output requested → no JSON mime type
    assert.equal(cfg.responseMimeType, undefined);
    assert.equal(cfg.responseJsonSchema, undefined);
  });

  test("effort axis maps to thinking_level (minimal/none/low→LOW, medium→MEDIUM, high/xhigh/max→HIGH)", async () => {
    for (const [effort, expected] of [
      ["none", "LOW"],
      ["minimal", "LOW"],
      ["low", "LOW"],
      ["medium", "MEDIUM"],
      ["high", "HIGH"],
      ["xhigh", "HIGH"],
      ["max", "HIGH"],
    ] as const) {
      const hh = installGeminiMock([geminiResponse({ parts: [{ text: "ok" }] })]);
      await geminiClient.createResponse({
        model: "gemini-3.8-flash",
        input: "hi",
        reasoning: { effort: effort as any },
      });
      assert.equal(hh.bodies[0].config.thinkingConfig.thinkingLevel, expected, `effort ${effort}`);
      hh.restore();
    }
    // no effort → model default level (thoughts still requested)
    const hn = installGeminiMock([geminiResponse({ parts: [{ text: "ok" }] })]);
    await geminiClient.createResponse({ model: "gemini-3.8-flash", input: "hi" });
    assert.deepEqual(hn.bodies[0].config.thinkingConfig, { includeThoughts: true });
    hn.restore();
  });

  test("tool_choice: required→ANY, none→NONE, named function→ANY+allowedFunctionNames", async () => {
    for (const [choice, expected] of [
      ["required", { mode: "ANY" }],
      ["none", { mode: "NONE" }],
      [
        { type: "function", name: "symbolic_compute" },
        { mode: "ANY", allowedFunctionNames: ["symbolic_compute"] },
      ],
    ] as const) {
      const hh = installGeminiMock([geminiResponse({ parts: [{ text: "ok" }] })]);
      await geminiClient.createResponse({
        model: "gemini-3.8-flash",
        input: "hi",
        tools: mainSolverTools,
        toolChoice: choice as any,
      });
      assert.deepEqual(hh.bodies[0].config.toolConfig, { functionCallingConfig: expected });
      hh.restore();
    }
  });

  test("responseFormat → responseMimeType application/json + responseJsonSchema (alongside tools)", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: '{"verdict":"accepted"}' }] })]);

    await geminiClient.createResponse({
      model: "gemini-3.8-flash",
      input: "verify this step",
      tools: mainSolverTools,
      responseFormat: stepVerificationSchema as any,
    });

    const cfg = h.bodies[0].config;
    assert.equal(cfg.responseMimeType, "application/json");
    assert.equal(cfg.responseJsonSchema.type, "object");
    assert.deepEqual(cfg.responseJsonSchema, (stepVerificationSchema as any).schema);
    assert.ok(Array.isArray(cfg.tools), "function declarations kept alongside the schema");
  });

  test("schema+tools rejection (400) retries once without the schema, keeping the tools", async () => {
    const rejection = Object.assign(
      new Error(
        "got status: 400 Bad Request. Function calling with a response mime type: 'application/json' is unsupported",
      ),
      { status: 400 },
    );
    h = installGeminiMock([rejection, geminiResponse({ parts: [{ text: '{"verdict":"accepted"}' }] })]);

    const res = await geminiClient.createResponse({
      model: "gemini-2.5-flash",
      input: "verify this step",
      tools: mainSolverTools,
      responseFormat: stepVerificationSchema as any,
    });

    assert.equal(h.bodies.length, 2);
    assert.equal(h.bodies[0].config.responseJsonSchema.type, "object");
    assert.equal(h.bodies[1].config.responseJsonSchema, undefined);
    assert.equal(h.bodies[1].config.responseMimeType, undefined);
    assert.ok(Array.isArray(h.bodies[1].config.tools));
    assert.equal((res.output[0] as any).content[0].text, '{"verdict":"accepted"}');
  });

  test("function_call/function_call_output round-trip: signature echoed, id + name on functionResponse, parallel calls grouped", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: "done" }] })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: PROBLEM } as ResponseInputItem,
      // Two parallel calls as emitted by a prior Gemini turn: only the first is signed.
      {
        type: "function_call",
        call_id: "fc-1",
        name: "symbolic_compute",
        arguments: '{"task":"a","dependsOn":[]}',
        __geminiThoughtSignature: "SIG_A",
      } as any,
      { type: "function_call", call_id: "fc-2", name: "numerical_compute", arguments: '{"task":"b","dependsOn":[]}' } as any,
      { type: "function_call_output", call_id: "fc-1", output: '{"ok":true,"result":"x"}' } as any,
      { type: "function_call_output", call_id: "fc-2", output: "plain text result" } as any,
    ];

    await geminiClient.createResponse({ model: "gemini-3.8-flash", input, tools: mainSolverTools });

    const contents = h.bodies[0].contents;
    // user(problem), model(FC1+sig, FC2), user(FR1, FR2)
    assert.deepEqual(contents.map((c: any) => c.role), ["user", "model", "user"]);
    const model = contents[1];
    assert.equal(model.parts.length, 2);
    assert.deepEqual(model.parts[0].functionCall, {
      name: "symbolic_compute",
      args: { task: "a", dependsOn: [] },
      id: "fc-1",
    });
    assert.equal(model.parts[0].thoughtSignature, "SIG_A", "real signature replayed on the first call");
    assert.equal(model.parts[1].functionCall.id, "fc-2");
    assert.equal(model.parts[1].thoughtSignature, undefined, "second parallel call stays unsigned");
    const responses = contents[2].parts;
    assert.equal(responses.length, 2);
    // JSON tool output is parsed under the documented `output` key; the name matches the call
    assert.deepEqual(responses[0].functionResponse, {
      name: "symbolic_compute",
      id: "fc-1",
      response: { output: { ok: true, result: "x" } },
    });
    assert.deepEqual(responses[1].functionResponse, {
      name: "numerical_compute",
      id: "fc-2",
      response: { output: "plain text result" },
    });
  });

  test("foreign (unsigned) function_call gets the documented skip-validation sentinel", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: "done" }] })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: PROBLEM } as ResponseInputItem,
      { type: "function_call", call_id: "call_openai_1", name: "ledger_append_entry", arguments: "{}" } as any,
      { type: "function_call_output", call_id: "call_openai_1", output: '{"ok":true}' } as any,
    ];

    await geminiClient.createResponse({ model: "gemini-3.8-flash", input, tools: mainSolverTools });

    const fc = geminiParts(h.bodies[0]).find((p: any) => p.functionCall);
    assert.equal(fc.thoughtSignature, "skip_thought_signature_validator");
  });

  test("sanitizer synthesizes a functionResponse for an orphan functionCall", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: "done" }] })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: PROBLEM } as ResponseInputItem,
      { type: "function_call", call_id: "orphan_1", name: "symbolic_compute", arguments: "{}", __geminiThoughtSignature: "S" } as any,
      // NO matching function_call_output → must be synthesized
      { type: "message", role: "user", content: "carry on" } as ResponseInputItem,
    ];

    await geminiClient.createResponse({ model: "gemini-3.8-flash", input, tools: mainSolverTools });

    const contents = h.bodies[0].contents;
    assert.deepEqual(contents.map((c: any) => c.role), ["user", "model", "user"]);
    const after = contents[2].parts;
    // synthetic error response FIRST, then the user's text
    assert.equal(after[0].functionResponse.id, "orphan_1");
    assert.equal(after[0].functionResponse.name, "symbolic_compute");
    assert.ok(typeof after[0].functionResponse.response.error === "string");
    assert.deepEqual(after[1], { text: "carry on" });
  });

  test("reasoning round-trips: signed thought replayed as a thought part, unsigned dropped", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: "ok" }] })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: "solve it" } as ResponseInputItem,
      {
        id: "r1",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "deep thought" }],
        content: [{ type: "reasoning_text", text: "deep thought" }],
        __geminiThoughtSignature: "sig-XYZ",
      } as any,
      {
        id: "r2",
        type: "reasoning",
        summary: [{ type: "summary_text", text: "foreign" }],
        content: [{ type: "reasoning_text", text: "foreign" }],
      } as any,
      { id: "m1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "answer", annotations: [] }] } as any,
    ];

    await geminiClient.createResponse({ model: "gemini-3.8-flash", input });

    const parts = geminiParts(h.bodies[0]);
    const thoughts = parts.filter((p: any) => p.thought === true);
    assert.equal(thoughts.length, 1, "only the signed thought is replayed");
    assert.deepEqual(thoughts[0], { thought: true, text: "deep thought", thoughtSignature: "sig-XYZ" });
    // signed thought and the assistant text share ONE model content
    assert.deepEqual(h.bodies[0].contents.map((c: any) => c.role), ["user", "model"]);
  });

  test("fetch_artifact_file pattern: input_image → inlineData, merged after the functionResponse in one user content", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: "ok" }] })]);

    const input: ResponseInputItem[] = [
      { type: "message", role: "user", content: "go" } as any,
      { type: "function_call", call_id: "f1", name: "fetch_artifact_file", arguments: "{}", __geminiThoughtSignature: "sig" } as any,
      { type: "function_call_output", call_id: "f1", output: '{"ok":true,"contentDelivered":"input_image"}' } as any,
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Inline content of fetched file" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" },
        ],
      } as any,
    ];

    await geminiClient.createResponse({ model: "gemini-3.8-flash", input });

    const contents = h.bodies[0].contents;
    assert.deepEqual(contents.map((c: any) => c.role), ["user", "model", "user"]);
    const last = contents[2].parts;
    assert.ok(last[0].functionResponse, "functionResponse first");
    assert.deepEqual(last[1], { text: "Inline content of fetched file" });
    assert.deepEqual(last[2], { inlineData: { mimeType: "image/png", data: "AAAA" } });
  });

  test("response → Response: thought/functionCall/text parts, signatures stashed, usage folds thoughts into output", async () => {
    h = installGeminiMock([
      geminiResponse({
        id: "gr1",
        parts: [
          { thought: true, text: "let me think" },
          {
            functionCall: { id: "fc-native", name: "symbolic_compute", args: { task: "x", dependsOn: [] } },
            thoughtSignature: "SIG_FC",
          },
          { text: "working on it", thoughtSignature: "SIG_TXT" },
        ],
        usage: {
          promptTokenCount: 80,
          cachedContentTokenCount: 20,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 15,
          totalTokenCount: 135,
        },
      }),
    ]);

    const res = await geminiClient.createResponse({ model: "gemini-3.8-flash", input: "go" });

    assert.equal(res.id, "gemini_gr1");
    const types = res.output.map((o: any) => o.type);
    assert.deepEqual(types, ["reasoning", "function_call", "message"]);
    const reasoning = res.output[0] as any;
    assert.equal(reasoning.summary[0].text, "let me think");
    assert.equal(reasoning.__geminiThoughtSignature, undefined, "unsigned thought carries no signature");
    const call = res.output[1] as any;
    assert.equal(call.call_id, "fc-native");
    assert.equal(call.name, "symbolic_compute");
    assert.equal(call.arguments, '{"task":"x","dependsOn":[]}');
    assert.equal(call.__geminiThoughtSignature, "SIG_FC");
    const msg = res.output[2] as any;
    assert.equal(msg.content[0].text, "working on it");
    assert.equal(msg.__geminiThoughtSignature, "SIG_TXT");

    const u: any = res.usage;
    assert.equal(u.input_tokens, 80, "promptTokenCount already includes cached tokens");
    assert.equal(u.input_tokens_details.cached_tokens, 20);
    assert.equal(u.output_tokens, 55, "candidates + thoughts");
    assert.equal(u.output_tokens_details.reasoning_tokens, 15);
    assert.equal(u.total_tokens, 135);
    assert.equal(res.model, "gemini-3.8-flash");
  });

  test("MAX_TOKENS finish marks the response incomplete", async () => {
    h = installGeminiMock([geminiResponse({ parts: [{ text: "partial" }], finishReason: "MAX_TOKENS" })]);
    const res = await geminiClient.createResponse({ model: "gemini-3.8-flash", input: "go" });
    assert.equal(res.status, "incomplete");
    assert.deepEqual(res.incomplete_details, { reason: "max_output_tokens" });
  });

  test("calls without a Gemini id get synthetic call_ids and are replayed without ids", async () => {
    h = installGeminiMock([
      geminiResponse({
        id: "t1",
        parts: [{ functionCall: { name: "symbolic_compute", args: {} }, thoughtSignature: "S1" }],
      }),
      geminiResponse({ id: "t2", parts: [{ text: "done" }] }),
    ]);

    const result = await geminiClient.runManualAgentLoop({
      model: "gemini-3.8-flash",
      input: [{ type: "message", role: "user", content: PROBLEM } as ResponseInputItem],
      tools: mainSolverTools,
      maxTurns: 3,
      handlers: { onToolCall: async () => '{"ok":true}' },
    });

    const call = result.responses[0]!.output.find((o: any) => o.type === "function_call") as any;
    assert.ok(call.call_id.startsWith("gemini_call_"), `synthetic id: ${call.call_id}`);
    const t2parts = geminiParts(h.bodies[1]);
    const fc = t2parts.find((p: any) => p.functionCall);
    const fr = t2parts.find((p: any) => p.functionResponse);
    assert.equal(fc.functionCall.id, undefined, "no fabricated id sent back on the call");
    assert.equal(fc.thoughtSignature, "S1");
    assert.equal(fr.functionResponse.id, undefined, "no fabricated id sent back on the response");
    assert.equal(fr.functionResponse.name, "symbolic_compute", "name resolved from the call");
    assert.ok(result.finalMessage);
  });

  test("previous_response_id: unknown id throws; known id replays the verbatim model content + names the outputs", async () => {
    const hu = installGeminiMock([geminiResponse({ parts: [{ text: "x" }] })]);
    await assert.rejects(
      () => geminiClient.createResponse({ model: "gemini-3.8-flash", input: "hi", previousResponseId: "does-not-exist" }),
      /unknown previousResponseId/,
    );
    hu.restore();

    const h2 = installGeminiMock([
      geminiResponse({
        id: "first",
        parts: [
          { thought: true, text: "unsigned summary" },
          { functionCall: { id: "fc-9", name: "run_python", args: { code: "1+1" } }, thoughtSignature: "SIG_9" },
        ],
      }),
      geminiResponse({ id: "second", parts: [{ text: '{"status":"success"}' }] }),
    ]);
    const r1 = await geminiClient.createResponse({
      model: "gemini-3.8-flash",
      instructions: "SYSTEM PROMPT",
      input: "first question",
    });
    // Sub-agent pattern: only the function_call_output travels on the next turn.
    await geminiClient.createResponse({
      model: "gemini-3.8-flash",
      instructions: "SYSTEM PROMPT",
      input: [{ type: "function_call_output", call_id: "fc-9", output: '{"stdout":"2"}' } as any],
      previousResponseId: r1.id,
    });

    const second = h2.bodies[1];
    // system instruction is a config field, present on every turn exactly once
    assert.equal(second.config.systemInstruction, "SYSTEM PROMPT");
    assert.deepEqual(second.contents.map((c: any) => c.role), ["user", "model", "user"]);
    assert.deepEqual(second.contents[0].parts, [{ text: "first question" }]);
    // the model content is Gemini's own parts (unsigned thought dropped, signed call kept verbatim)
    assert.deepEqual(second.contents[1].parts, [
      { functionCall: { id: "fc-9", name: "run_python", args: { code: "1+1" } }, thoughtSignature: "SIG_9" },
    ]);
    assert.deepEqual(second.contents[2].parts, [
      { functionResponse: { name: "run_python", id: "fc-9", response: { output: { stdout: "2" } } } },
    ]);
    h2.restore();
  });
});

// =========================================================================
// TEST PROBLEM — multi-turn agent loops (end-to-end through each client)
// =========================================================================

describe("Test problem — multi-turn solver loop (manual state)", () => {
  test("Claude: accumulates conversation/context/reasoning/tool turns correctly", async () => {
    // Turn 1: think + append a ledger entry. Turn 2: think + submit answer. Turn 3: final message.
    const h = installClaudeMock([
      claudeMessage({
        id: "t1",
        content: [
          { type: "thinking", thinking: "rational roots are 1,2,3", signature: "sig1" },
          { type: "tool_use", id: "tu_ledger", name: "ledger_append_entry", input: { type: "derivation" } },
        ],
      }),
      claudeMessage({
        id: "t2",
        content: [
          { type: "thinking", thinking: "verified all three roots", signature: "sig2" },
          { type: "tool_use", id: "tu_final", name: "submit_final_answer", input: { answer: "x=1,2,3" } },
        ],
      }),
      claudeMessage({ id: "t3", content: [{ type: "text", text: "The real solutions are x = 1, 2, 3." }] }),
    ]);

    const toolOutputs: Record<string, string> = {
      ledger_append_entry: '{"ok":true,"entryId":"entry-3"}',
      submit_final_answer: '{"ok":true,"status":"submitted"}',
    };

    const result = await claudeClient.runManualAgentLoop({
      model: "claude-sonnet-4-6",
      instructions: MAIN_SOLVER_PROMPT,
      input: buildSolverInput(),
      tools: mainSolverTools,
      reasoning: { effort: "max" },
      maxTurns: 5,
      handlers: {
        onToolCall: async (call) => toolOutputs[call.name] ?? "{}",
      },
    });

    // 3 model calls were made
    assert.equal(h.bodies.length, 3);

    // Turn 2 request must contain: the seeded developer ledger context (in system),
    // the user problem, the turn-1 thinking (signed), the turn-1 tool_use, and its tool_result.
    const t2 = h.bodies[1];
    assert.ok(t2.system.includes("[entry-1] type=assumption"), "ledger context still in system");
    const t2blocks = t2.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
    assert.ok(t2blocks.some((b: any) => b.type === "thinking" && b.signature === "sig1"), "turn-1 reasoning replayed with signature");
    assert.ok(t2blocks.some((b: any) => b.type === "tool_use" && b.id === "tu_ledger"));
    assert.ok(t2blocks.some((b: any) => b.type === "tool_result" && b.tool_use_id === "tu_ledger"));

    // Turn 3 request must additionally carry turn-2 tool_use + its result.
    const t3 = h.bodies[2];
    const t3blocks = t3.messages.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
    assert.ok(t3blocks.some((b: any) => b.type === "tool_use" && b.id === "tu_final"));
    assert.ok(t3blocks.some((b: any) => b.type === "tool_result" && b.tool_use_id === "tu_final"));

    assert.ok(result.finalMessage, "loop produced a final message");
    assert.equal(
      result.finalMessage!.content.map((c: any) => c.text).join(""),
      "The real solutions are x = 1, 2, 3.",
    );
    h.restore();
  });

  test("HuggingFace: accumulates conversation/context/tool turns correctly (reasoning dropped)", async () => {
    const h = installHfMock([
      hfCompletion({
        id: "t1",
        toolCalls: [
          { id: "call_ledger", type: "function", function: { name: "ledger_append_entry", arguments: '{"type":"derivation"}' } },
        ],
      }),
      hfCompletion({
        id: "t2",
        toolCalls: [
          { id: "call_final", type: "function", function: { name: "submit_final_answer", arguments: '{"answer":"x=1,2,3"}' } },
        ],
      }),
      hfCompletion({ id: "t3", content: "The real solutions are x = 1, 2, 3." }),
    ]);

    const toolOutputs: Record<string, string> = {
      ledger_append_entry: '{"ok":true,"entryId":"entry-3"}',
      submit_final_answer: '{"ok":true,"status":"submitted"}',
    };

    const result = await hfClient.runManualAgentLoop({
      model: "zai-org/GLM-5.2:together",
      instructions: MAIN_SOLVER_PROMPT,
      input: buildSolverInput(),
      tools: mainSolverTools,
      reasoning: { effort: "max" },
      maxTurns: 5,
      handlers: { onToolCall: async (call) => toolOutputs[call.name] ?? "{}" },
    });

    assert.equal(h.bodies.length, 3);
    const t3 = h.bodies[2].messages;
    // system carried through; problem present; both tool calls + tool results present
    assert.equal(t3[0].role, "system");
    assert.ok(t3[0].content.includes("[entry-1] type=assumption"));
    const toolMsgIds = t3.filter((m: any) => m.role === "tool").map((m: any) => m.tool_call_id).sort();
    assert.deepEqual(toolMsgIds, ["call_final", "call_ledger"]);
    assert.ok(result.finalMessage);
    assert.equal(
      result.finalMessage!.content.map((c: any) => c.text ?? c.refusal ?? "").join(""),
      "The real solutions are x = 1, 2, 3.",
    );
    h.restore();
  });

  test("Gemini: accumulates conversation/context/thought-signature/tool turns correctly", async () => {
    // Turn 1: think + append a ledger entry. Turn 2: think + submit answer. Turn 3: final message.
    const h = installGeminiMock([
      geminiResponse({
        id: "t1",
        parts: [
          { thought: true, text: "rational roots are 1,2,3" },
          { functionCall: { id: "g_ledger", name: "ledger_append_entry", args: { type: "derivation" } }, thoughtSignature: "sig1" },
        ],
      }),
      geminiResponse({
        id: "t2",
        parts: [
          { thought: true, text: "verified all three roots" },
          { functionCall: { id: "g_final", name: "submit_final_answer", args: { answer: "x=1,2,3" } }, thoughtSignature: "sig2" },
        ],
      }),
      geminiResponse({ id: "t3", parts: [{ text: "The real solutions are x = 1, 2, 3.", thoughtSignature: "sig3" }] }),
    ]);

    const toolOutputs: Record<string, string> = {
      ledger_append_entry: '{"ok":true,"entryId":"entry-3"}',
      submit_final_answer: '{"ok":true,"status":"submitted"}',
    };

    const result = await geminiClient.runManualAgentLoop({
      model: "gemini-3.8-flash",
      instructions: MAIN_SOLVER_PROMPT,
      input: buildSolverInput(),
      tools: mainSolverTools,
      reasoning: { effort: "max" },
      maxTurns: 5,
      handlers: { onToolCall: async (call) => toolOutputs[call.name] ?? "{}" },
    });

    assert.equal(h.bodies.length, 3);

    // Turn 2 request: ledger context still in the system instruction; the
    // turn-1 call carries its signature and is answered by a named response.
    const t2 = h.bodies[1];
    assert.ok(t2.config.systemInstruction.includes("[entry-1] type=assumption"));
    assert.deepEqual(t2.contents.map((c: any) => c.role), ["user", "model", "user"]);
    const t2parts = geminiParts(t2);
    const fc1 = t2parts.find((p: any) => p.functionCall?.id === "g_ledger");
    assert.equal(fc1.thoughtSignature, "sig1", "turn-1 signature replayed on the call part");
    assert.ok(!t2parts.some((p: any) => p.thought), "unsigned thought summaries are not re-sent");
    const fr1 = t2parts.find((p: any) => p.functionResponse?.id === "g_ledger");
    assert.equal(fr1.functionResponse.name, "ledger_append_entry");
    assert.deepEqual(fr1.functionResponse.response, { output: { ok: true, entryId: "entry-3" } });

    // Turn 3 request: strictly alternating history with both steps present.
    const t3 = h.bodies[2];
    assert.deepEqual(t3.contents.map((c: any) => c.role), ["user", "model", "user", "model", "user"]);
    const t3parts = geminiParts(t3);
    assert.ok(t3parts.some((p: any) => p.functionCall?.id === "g_final" && p.thoughtSignature === "sig2"));
    assert.ok(t3parts.some((p: any) => p.functionResponse?.id === "g_final"));

    assert.ok(result.finalMessage, "loop produced a final message");
    assert.equal(
      result.finalMessage!.content.map((c: any) => c.text).join(""),
      "The real solutions are x = 1, 2, 3.",
    );
    // the final text's signature is kept on the message item for any later replay
    assert.equal((result.finalMessage as any).__geminiThoughtSignature, "sig3");
    h.restore();
  });
});

// =========================================================================
// USAGE LEDGER — token + cost attribution through the llmClient choke point
// =========================================================================

describe("Usage ledger — attribution through llmClient.createResponse", () => {
  let originalRecord: typeof usageRepo.record;
  let recorded: any[];

  beforeEach(() => {
    originalRecord = usageRepo.record;
    recorded = [];
    (usageRepo as any).record = async (input: any) => {
      recorded.push(input);
      return { ...input.tokens, costUsd: input.costUsd, calls: 1 };
    };
  });
  afterEach(() => {
    (usageRepo as any).record = originalRecord;
  });

  test("routed call records correct tokens + cost + role for the resolved provider/model", async () => {
    // Pin fast/main_solver to a HuggingFace model with known list pricing so
    // the mocked transport and the expected cost are independent of the
    // current PROVIDER_MATRIX / MODEL_MATRIX. The module-level network guard
    // still makes any transport mismatch fail loudly.
    const model = "deepseek-ai/DeepSeek-V4-Pro-0813:together";
    const restoreRouting = llmClient.overrideRoutingForTests("fast", "main_solver", {
      provider: "huggingface",
      model,
    });
    assert.equal(llmClient.providerFor("fast", "main_solver"), "huggingface");
    assert.equal(llmClient.modelFor("fast", "main_solver"), model);

    const h = installHfMock([
      hfCompletion({
        content: "answer",
        usage: {
          prompt_tokens: 1000,
          prompt_tokens_details: { cached_tokens: 200 },
          completion_tokens: 500,
          completion_tokens_details: { reasoning_tokens: 100 },
          total_tokens: 1500,
        },
      }),
    ]);

    await runWithUsageContext({ conversationId: "conv-test-1", ledgerId: "ledger-1" }, async () => {
      await llmClient.createResponse({
        reasoningSpeed: "fast",
        reasoningRole: "main_solver",
        instructions: "sys",
        input: PROBLEM,
      });
      // recordResponseUsageSafe is fire-and-forget; let the microtask settle.
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(h.bodies.length, 1, "exactly one (mocked) HuggingFace call");
    assert.equal(h.bodies[0].model, model, "matrix-resolved model sent on the wire");

    assert.equal(recorded.length, 1, "exactly one usage record");
    const rec = recorded[0];
    assert.equal(rec.provider, "huggingface");
    assert.equal(rec.model, model);
    assert.equal(rec.role, "main_solver");
    assert.equal(rec.conversationId, "conv-test-1");
    assert.equal(rec.ledgerId, "ledger-1");
    assert.equal(rec.tokens.inputTokens, 1000);
    assert.equal(rec.tokens.cachedInputTokens, 200);
    assert.equal(rec.tokens.outputTokens, 500);
    assert.equal(rec.tokens.reasoningTokens, 100);
    assert.equal(rec.tokens.totalTokens, 1500);

    // cost computed from DeepSeek V4 Pro 0813 Together list pricing:
    // (800 uncached input * 1.32 + 200 cached * 0.13 + 500 output * 3.96) / 1e6
    const expected = (800 * 1.32 + 200 * 0.13 + 500 * 3.96) / 1_000_000;
    assert.ok(Math.abs(rec.costUsd - expected) < 1e-12, `cost ${rec.costUsd} ≈ ${expected}`);
    h.restore();
    restoreRouting();
  });

  test("Gemini-routed call records provider/model/tokens + cost from Gemini list pricing", async () => {
    const model = "gemini-3.8-flash";
    const restoreRouting = llmClient.overrideRoutingForTests("fast", "computation", {
      provider: "gemini",
      model,
    });
    assert.equal(llmClient.providerFor("fast", "computation"), "gemini");

    const h = installGeminiMock([
      geminiResponse({
        parts: [{ text: "answer" }],
        usage: {
          promptTokenCount: 1000,
          cachedContentTokenCount: 200,
          candidatesTokenCount: 400,
          thoughtsTokenCount: 100,
          totalTokenCount: 1500,
        },
      }),
    ]);

    await runWithUsageContext({ conversationId: "conv-test-1", ledgerId: "ledger-1" }, async () => {
      await llmClient.createResponse({
        reasoningSpeed: "fast",
        reasoningRole: "computation",
        instructions: "sys",
        input: PROBLEM,
      });
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(h.bodies.length, 1, "exactly one (mocked) Gemini call");
    assert.equal(h.bodies[0].model, model);
    assert.equal(recorded.length, 1);
    const rec = recorded[0];
    assert.equal(rec.provider, "gemini");
    assert.equal(rec.model, model);
    assert.equal(rec.role, "computation");
    assert.equal(rec.tokens.inputTokens, 1000);
    assert.equal(rec.tokens.cachedInputTokens, 200);
    assert.equal(rec.tokens.outputTokens, 500, "candidates + thoughts");
    assert.equal(rec.tokens.reasoningTokens, 100);
    assert.equal(rec.tokens.totalTokens, 1500);
    // (800 uncached * 0.75 + 200 cached * 0.075 + 500 output * 3.75) / 1e6
    const expected = (800 * 0.75 + 200 * 0.075 + 500 * 3.75) / 1_000_000;
    assert.ok(Math.abs(rec.costUsd - expected) < 1e-12, `cost ${rec.costUsd} ≈ ${expected}`);
    h.restore();
    restoreRouting();
  });

  test("pricing resolves Gemini ids with the models/ resource prefix", () => {
    assert.deepEqual(pricingFor("models/gemini-3.1-pro-preview"), pricingFor("gemini-3.1-pro-preview"));
    assert.ok(pricingFor("gemini-3.1-pro-preview"));
  });

  test("pricing resolves HF model id via :together suffix fallback", () => {
    assert.ok(
      pricingFor("deepseek-ai/DeepSeek-V4-Pro:together"),
      "pricing resolved with provider suffix",
    );
    const cost = computeCostUsd("deepseek-ai/DeepSeek-V4-Pro:together", {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
    });
    assert.ok(Math.abs(cost - (1000 * 1.74) / 1_000_000) < 1e-12);
  });
});
