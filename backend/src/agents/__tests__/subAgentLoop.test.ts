/**
 * Sub-agent loop resilience suite.
 *
 * Covers the fixes for the previous_response_id fragility finding of the
 * agentic-loop audit:
 *
 *  1. `isMissingPreviousResponseError` classifies exactly the recoverable
 *     "broken chain" errors (OpenAI expired/deleted stored response, or the
 *     Claude / HuggingFace / Gemini in-process emulation cache missing an id).
 *  2. Sub-agent loops on non-OpenAI providers use manual conversation state:
 *     the full input array is re-sent every turn, so no in-process cache can
 *     lose the conversation. Verified here with the routing pinned per test
 *     (step verification on Claude, computation on HuggingFace and Gemini).
 *  3. When a loop DOES chain on OpenAI server-side state, a broken chain
 *     restarts the loop once from its initial input instead of failing the
 *     whole verification / computation tool call.
 *
 * Every provider transport is replaced by a scripted mock before any test
 * runs; no test in this file can reach the network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerEntry } from "../../db/types";
import type { ToolContext } from "../../tools/types";
import { anthropic } from "../claudeClient";
import { gemini } from "../geminiClient";
import { hf } from "../hfClient";
import {
  isMissingPreviousResponseError,
  modelFor,
  overrideRoutingForTests,
  providerFor,
} from "../llmClient";
import { openai } from "../openaiClient";
import { runStepVerificationAgent } from "../stepVerificationAgent";
import { runComputationSubAgent } from "../symbolicAgent";

// -------------------------------------------------------------------------
// No-live-network guard + scripted transport mocks.
// -------------------------------------------------------------------------

(openai.responses as any).create = async () => {
  throw new Error(
    "Test attempted a LIVE OpenAI Responses call — install a mock (installOpenAiMock) for this code path.",
  );
};
(anthropic.messages as any).stream = () => {
  throw new Error(
    "Test attempted a LIVE Anthropic call — install a mock (installClaudeMock) for this code path.",
  );
};
(hf.chat.completions as any).create = async () => {
  throw new Error(
    "Test attempted a LIVE HuggingFace call — install a mock (installHfMock) for this code path.",
  );
};
(gemini.models as any).generateContent = async () => {
  throw new Error(
    "Test attempted a LIVE Gemini call — install a mock (installGeminiMock) for this code path.",
  );
};

interface ScriptEntry {
  /** Response payload to return, or an error to throw for this call. */
  response?: any;
  throws?: unknown;
}

interface Harness {
  bodies: any[];
  restore: () => void;
}

function installOpenAiMock(script: ScriptEntry[]): Harness {
  const bodies: any[] = [];
  const queue = [...script];
  const original = (openai.responses as any).create;
  (openai.responses as any).create = async (body: any) => {
    bodies.push(body);
    const entry = queue.shift();
    if (!entry) throw new Error("OpenAI mock script exhausted");
    if (entry.throws !== undefined) throw entry.throws;
    return entry.response;
  };
  return {
    bodies,
    restore: () => {
      (openai.responses as any).create = original;
    },
  };
}

function installClaudeMock(script: any[]): Harness {
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

function installHfMock(script: any[]): Harness {
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

function installGeminiMock(script: any[]): Harness {
  const bodies: any[] = [];
  const queue = [...script];
  const original = (gemini.models as any).generateContent;
  (gemini.models as any).generateContent = async (params: any) => {
    bodies.push(JSON.parse(JSON.stringify(params)));
    return queue.shift();
  };
  return {
    bodies,
    restore: () => {
      (gemini.models as any).generateContent = original;
    },
  };
}

// -------------------------------------------------------------------------
// Response fixtures.
// -------------------------------------------------------------------------

const OPENAI_USAGE = {
  input_tokens: 10,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 5,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 15,
};

function openaiBase(id: string, output: any[]): any {
  return {
    id,
    object: "response",
    created_at: 1_700_000_000,
    status: "completed",
    model: "gpt-test",
    output,
    output_text: "",
    error: null,
    incomplete_details: null,
    usage: OPENAI_USAGE,
  };
}

/** A turn that calls an unknown tool — dispatched locally with no side
 * effects (no DB, no Python), which keeps the loop going. */
function openaiToolCall(id: string, callId: string): any {
  return openaiBase(id, [
    {
      type: "function_call",
      id: `fc_${callId}`,
      call_id: callId,
      name: "unknown_tool_for_test",
      arguments: JSON.stringify({ task: "noop" }),
      status: "completed",
    },
  ]);
}

function openaiFinalMessage(id: string, text: string): any {
  return openaiBase(id, [
    {
      type: "message",
      id: `msg_${id}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    },
  ]);
}

function openaiChainError(): Error {
  const err = new Error("400 Previous response with id 'resp_gone' not found.");
  (err as any).status = 400;
  return err;
}

function claudeMessage(opts: { id?: string; content: any[]; stopReason?: string }): any {
  return {
    id: opts.id ?? "msg_claude_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    stop_reason: opts.stopReason ?? "end_turn",
    stop_sequence: null,
    content: opts.content,
    usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 },
  };
}

function hfCompletion(opts: { id?: string; content?: string | null; toolCalls?: any[] }): any {
  return {
    id: opts.id ?? "chatcmpl_test",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "deepseek-test",
    choices: [
      {
        index: 0,
        finish_reason: opts.toolCalls ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: opts.content ?? null,
          ...(opts.toolCalls ? { tool_calls: opts.toolCalls } : {}),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function geminiResponse(opts: { id?: string; parts: any[] }): any {
  return {
    responseId: opts.id ?? "gresp_test",
    modelVersion: "gemini-test",
    candidates: [{ index: 0, finishReason: "STOP", content: { role: "model", parts: opts.parts } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  };
}

// -------------------------------------------------------------------------
// isMissingPreviousResponseError classification.
// -------------------------------------------------------------------------

test("isMissingPreviousResponseError: OpenAI 400 'Previous response ... not found'", () => {
  assert.equal(isMissingPreviousResponseError(openaiChainError()), true);
});

test("isMissingPreviousResponseError: OpenAI 404 variant", () => {
  const err = new Error("Previous response with id 'resp_x' not found.");
  (err as any).status = 404;
  assert.equal(isMissingPreviousResponseError(err), true);
});

test("isMissingPreviousResponseError: claude/hf/gemini emulation cache miss", () => {
  assert.equal(
    isMissingPreviousResponseError(
      new Error("claudeClient: unknown previousResponseId 'resp_abc' (cache miss)"),
    ),
    true,
  );
  assert.equal(
    isMissingPreviousResponseError(
      new Error("geminiClient: unknown previousResponseId 'gemini_x'. The Gemini provider keeps conversation state in-process"),
    ),
    true,
  );
});

test("isMissingPreviousResponseError: unrelated errors are not recoverable", () => {
  const badRequest = new Error("400 Invalid schema for tool 'run_python'.");
  (badRequest as any).status = 400;
  assert.equal(isMissingPreviousResponseError(badRequest), false);

  const noStatus = new Error("Previous response with id 'resp_x' not found.");
  assert.equal(isMissingPreviousResponseError(noStatus), false);

  assert.equal(isMissingPreviousResponseError(new Error("ECONNRESET")), false);
  assert.equal(isMissingPreviousResponseError("string error"), false);
  assert.equal(isMissingPreviousResponseError(undefined), false);
});

// -------------------------------------------------------------------------
// Manual conversation state on non-OpenAI providers (per the live matrix).
// -------------------------------------------------------------------------

function makeParentCtx(): ToolContext {
  return {
    conversation: {
      _id: "conv-test",
      additionalTools: { cyAnalyst: false, referenceSeeker: false },
    } as any,
    ledger: { _id: "ledger-test" } as any,
    extraInputItems: [],
    reasoningSpeed: "high",
  };
}

function makeLedgerEntry(): LedgerEntry {
  return {
    _id: "entry-1",
    ledgerId: "ledger-test",
    type: "claim",
    status: "pending",
    dependsOn: [],
    content: { summary: "2 + 2 = 4", detail: "arithmetic" },
  } as any;
}

function claudeBlockTypes(msg: any): string[] {
  return Array.isArray(msg.content) ? msg.content.map((b: any) => b.type) : ["text"];
}

test("step verification on Claude uses manual state: full history re-sent each turn", async () => {
  // Pin the role to Claude regardless of the current matrices: this test is
  // about the Claude back-end's manual-state behaviour, not about routing.
  const restoreRouting = overrideRoutingForTests("high", "step_verification", {
    provider: "claude",
    model: "claude-sonnet-4-6",
  });

  const verdict = JSON.stringify({
    verdict: "accepted",
    justification: "trivially true",
    method: "inspection",
    counterExample: null,
  });

  const h = installClaudeMock([
    claudeMessage({
      stopReason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "unknown_tool_for_test",
          input: { task: "noop" },
        },
      ],
    }),
    claudeMessage({ content: [{ type: "text", text: verdict }] }),
  ]);

  try {
    const result = await runStepVerificationAgent(
      { target: makeLedgerEntry(), dependencies: [], focus: "check arithmetic" },
      makeParentCtx(),
    );
    assert.equal(result.verdict, "accepted");

    assert.equal(h.bodies.length, 2);
    assert.equal(h.bodies[0].model, modelFor("high", "step_verification"));
    assert.ok(typeof h.bodies[0].system === "string" || Array.isArray(h.bodies[0].system));

    // Turn 1: just the initial user prompt.
    assert.equal(h.bodies[0].messages.length, 1);
    assert.equal(h.bodies[0].messages[0].role, "user");

    // Turn 2: full history carried by the caller — the initial user prompt,
    // the assistant tool_use turn, and the tool_result — with no reliance on
    // any previous-response cache.
    const roles = h.bodies[1].messages.map((m: any) => m.role);
    assert.deepEqual(roles, ["user", "assistant", "user"]);
    assert.ok(claudeBlockTypes(h.bodies[1].messages[1]).includes("tool_use"));
    assert.ok(claudeBlockTypes(h.bodies[1].messages[2]).includes("tool_result"));
  } finally {
    h.restore();
    restoreRouting();
  }
});

test("computation on HuggingFace uses manual state: full history re-sent each turn", async () => {
  // Pin the role to HuggingFace regardless of the current matrices.
  const restoreRouting = overrideRoutingForTests("fast", "computation", {
    provider: "huggingface",
    model: "deepseek-ai/DeepSeek-V4-Pro-0813:together",
  });

  const structured = JSON.stringify({
    status: "success",
    result: "42",
    summary: "done",
    code: "",
    error: null,
  });

  const h = installHfMock([
    hfCompletion({
      id: "t1",
      toolCalls: [
        {
          id: "call_hf_1",
          type: "function",
          function: { name: "unknown_tool_for_test", arguments: '{"task":"noop"}' },
        },
      ],
    }),
    hfCompletion({ id: "t2", content: structured }),
  ]);

  try {
    const result = await runComputationSubAgent({
      instructions: "You are a test computation agent.",
      promptCacheKey: "test-computation",
      task: "compute the answer",
      reasoningSpeed: "fast",
    });
    assert.equal(result.status, "success");
    assert.equal(result.result, "42");

    assert.equal(h.bodies.length, 2);
    assert.equal(h.bodies[0].model, modelFor("fast", "computation"));

    // Turn 2 re-sends the whole conversation: system, initial user task,
    // assistant tool_calls turn, and the tool result.
    const roles = h.bodies[1].messages.map((m: any) => m.role);
    assert.deepEqual(roles, ["system", "user", "assistant", "tool"]);
    assert.equal(h.bodies[1].messages[2].tool_calls[0].id, "call_hf_1");
    assert.equal(h.bodies[1].messages[3].tool_call_id, "call_hf_1");
  } finally {
    h.restore();
    restoreRouting();
  }
});

test("computation on Gemini uses manual state: full history re-sent each turn with thought signatures", async () => {
  // Pin the role to Gemini regardless of the current matrices.
  const restoreRouting = overrideRoutingForTests("fast", "computation", {
    provider: "gemini",
    model: "gemini-3.8-flash",
  });

  const structured = JSON.stringify({
    status: "success",
    result: "42",
    summary: "done",
    code: "",
    error: null,
  });

  const h = installGeminiMock([
    geminiResponse({
      id: "t1",
      parts: [
        {
          functionCall: { id: "gcall_1", name: "unknown_tool_for_test", args: { task: "noop" } },
          thoughtSignature: "SIG_1",
        },
      ],
    }),
    geminiResponse({ id: "t2", parts: [{ text: structured }] }),
  ]);

  try {
    const result = await runComputationSubAgent({
      instructions: "You are a test computation agent.",
      promptCacheKey: "test-computation",
      task: "compute the answer",
      reasoningSpeed: "fast",
    });
    assert.equal(result.status, "success");
    assert.equal(result.result, "42");

    assert.equal(h.bodies.length, 2);
    assert.equal(h.bodies[0].model, modelFor("fast", "computation"));
    assert.equal(h.bodies[0].config.systemInstruction, "You are a test computation agent.");
    // structured output + function declarations travel together on every turn
    assert.equal(h.bodies[0].config.responseMimeType, "application/json");
    assert.ok(Array.isArray(h.bodies[0].config.tools));

    // Turn 1: just the initial user prompt.
    assert.deepEqual(h.bodies[0].contents.map((c: any) => c.role), ["user"]);

    // Turn 2 re-sends the whole conversation with no previous-response
    // chaining: user task, model functionCall (signature intact), user
    // functionResponse matched by id and name.
    const roles = h.bodies[1].contents.map((c: any) => c.role);
    assert.deepEqual(roles, ["user", "model", "user"]);
    const fc = h.bodies[1].contents[1].parts[0];
    assert.equal(fc.functionCall.id, "gcall_1");
    assert.equal(fc.thoughtSignature, "SIG_1");
    const fr = h.bodies[1].contents[2].parts[0];
    assert.equal(fr.functionResponse.id, "gcall_1");
    assert.equal(fr.functionResponse.name, "unknown_tool_for_test");
  } finally {
    h.restore();
    restoreRouting();
  }
});

// -------------------------------------------------------------------------
// Restart-on-miss for OpenAI server-side chaining.
//
// The chained path is exercised through a reasoningRole that the
// matrix still routes to OpenAI. If reference_seeker ever leaves OpenAI,
// pick any other OpenAI-routed role here.
// -------------------------------------------------------------------------

const OPENAI_ROLE = "reference_seeker" as const;

function computationOnOpenAi() {
  assert.equal(
    providerFor("high", OPENAI_ROLE),
    "openai",
    "no OpenAI-routed role left — re-target the chained-loop tests",
  );
  return runComputationSubAgent({
    instructions: "You are a test computation agent.",
    promptCacheKey: "test-computation",
    task: "compute the answer",
    reasoningSpeed: "high",
    reasoningRole: OPENAI_ROLE,
  });
}

test("chained sub-agent loop restarts once from the initial input when the chain breaks", async () => {
  const structured = JSON.stringify({
    status: "success",
    result: "42",
    summary: "done",
    code: "",
    error: null,
  });

  const h = installOpenAiMock([
    // Turn 1: model calls an unknown tool, establishing a chain.
    { response: openaiToolCall("resp_a", "call_a") },
    // Turn 2: the stored previous response has vanished.
    { throws: openaiChainError() },
    // Restarted turn 1: model answers immediately.
    { response: openaiFinalMessage("resp_b", structured) },
  ]);

  try {
    const result = await computationOnOpenAi();
    assert.equal(result.status, "success");
    assert.equal(result.result, "42");
    assert.deepEqual(result.openaiResponseIds, ["resp_a", "resp_b"]);

    assert.equal(h.bodies.length, 3, "three transport calls (one failed)");
    // First call: fresh chain, initial prompt as a string.
    assert.equal(h.bodies[0].previous_response_id, undefined);
    assert.equal(typeof h.bodies[0].input, "string");
    // Second call: chained onto resp_a with the tool output.
    assert.equal(h.bodies[1].previous_response_id, "resp_a");
    assert.ok(Array.isArray(h.bodies[1].input));
    assert.equal(h.bodies[1].input[0].type, "function_call_output");
    // Third call: restarted — no chain, initial prompt again.
    assert.equal(h.bodies[2].previous_response_id, undefined);
    assert.equal(h.bodies[2].input, h.bodies[0].input, "restart re-sends the initial task");
  } finally {
    h.restore();
  }
});

test("chained sub-agent loop does not restart twice — second chain break propagates", async () => {
  const h = installOpenAiMock([
    { response: openaiToolCall("resp_a", "call_a") },
    { throws: openaiChainError() },
    { response: openaiToolCall("resp_b", "call_b") },
    { throws: openaiChainError() },
  ]);

  try {
    await assert.rejects(computationOnOpenAi(), /Previous response/);
    assert.equal(h.bodies.length, 4);
  } finally {
    h.restore();
  }
});

test("chained sub-agent loop: unrelated errors still propagate immediately", async () => {
  // A 400 that is NOT about a missing previous response: no retry (the
  // client only retries transient statuses) and no chain restart.
  const boom = new Error("400 Invalid schema for tool 'run_python'.");
  (boom as any).status = 400;

  const h = installOpenAiMock([
    { response: openaiToolCall("resp_a", "call_a") },
    { throws: boom },
  ]);

  try {
    await assert.rejects(computationOnOpenAi(), /Invalid schema/);
    assert.equal(h.bodies.length, 2, "no restart for non-chain errors");
  } finally {
    h.restore();
  }
});
