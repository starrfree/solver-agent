/**
 * Client audit suite.
 *
 * Goal: prove (with captured runtime payloads) that the Claude and HuggingFace
 * clients correctly translate our provider-agnostic Responses-shaped input
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
