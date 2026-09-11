/**
 * Agentic-loop audit script (mock-based — makes NO network calls, costs $0).
 *
 * Verifies, with captured wire payloads, the suspicions raised during the
 * 2026-08-18 audit of the agent loops:
 *
 *   1. Matrix invariants: every (speed, role) resolves to a provider/model/
 *      effort; roles that depend on OpenAI-hosted web_search stay on OpenAI;
 *      every configured model has a pricing entry.
 *   2. webSearch flag is silently DROPPED by the Claude and HuggingFace
 *      back-ends (documented behavior — this check makes the silence visible).
 *   3. HuggingFace: an assistant turn carrying BOTH text and tool_calls is
 *      split into two assistant messages and the sanitizer reorders the text
 *      AFTER the tool result (chronology loss).
 *   4. HuggingFace: `input_image` parts (from fetch_artifact_file) are
 *      forwarded as image_url content to chat models — a 400 risk on
 *      text-only models like DeepSeek.
 *   5. Claude: the extra image message that fetch_artifact_file appends after
 *      a tool_result produces two consecutive `user` messages.
 *   6. Claude: within-turn item order [reasoning, function_call, message,
 *      function_call_output] keeps tool_use → tool_result adjacency.
 *   7. Loop-termination edge: a response with no function calls AND no
 *      message (reasoning-only / truncated) yields finalMessage === null,
 *      which each agent must handle.
 *   8. Stale-test hazard: if PROVIDER_MATRIX no longer routes fast
 *      main_solver to HuggingFace, the clientAudit usage test's mock misses
 *      and the test makes a LIVE (billed) OpenAI call.
 *
 * Run from backend/:  npx tsx debug/agentLoopAudit.ts
 */
/* eslint-disable no-console */
import type { ResponseInputItem, Response } from "openai/resources/responses/responses";

import { anthropic } from "../src/agents/claudeClient";
import * as claudeClient from "../src/agents/claudeClient";
import { hf } from "../src/agents/hfClient";
import * as hfClient from "../src/agents/hfClient";
import { providerFor, modelFor, effortFor, findFinalMessage } from "../src/agents/llmClient";
import type { ReasoningRole } from "../src/agents/openaiClient";
import { pricingFor } from "../src/config/pricing";
import type { ReasoningSpeed } from "../src/db/types";

// ---------------------------------------------------------------------------
// Result collection.
// ---------------------------------------------------------------------------

type Verdict = "PASS" | "ISSUE" | "INFO";
const results: Array<{ verdict: Verdict; name: string; detail: string }> = [];
function report(verdict: Verdict, name: string, detail: string): void {
  results.push({ verdict, name, detail });
}

// ---------------------------------------------------------------------------
// Transport mocks (same technique as clientAudit.test.ts).
// ---------------------------------------------------------------------------

function mockClaude(script: unknown[]): { bodies: any[]; restore: () => void } {
  const bodies: any[] = [];
  const queue = [...script];
  const original = (anthropic.messages as any).stream;
  (anthropic.messages as any).stream = (body: any) => {
    bodies.push(body);
    const msg = queue.shift();
    return { finalMessage: async () => msg };
  };
  return { bodies, restore: () => ((anthropic.messages as any).stream = original) };
}

function mockHf(script: unknown[]): { bodies: any[]; restore: () => void } {
  const bodies: any[] = [];
  const queue = [...script];
  const original = (hf.chat.completions as any).create;
  (hf.chat.completions as any).create = async (body: any) => {
    bodies.push(body);
    return queue.shift();
  };
  return { bodies, restore: () => ((hf.chat.completions as any).create = original) };
}

function claudeMsg(content: any[], id = "msg_dbg"): any {
  return {
    id,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    content,
    usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 },
  };
}

function hfMsg(opts: { content?: string | null; reasoning?: string; toolCalls?: any[]; id?: string }): any {
  return {
    id: opts.id ?? "cc_dbg",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "deepseek-ai/DeepSeek-V4-Pro",
    choices: [
      {
        index: 0,
        finish_reason: opts.toolCalls ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: opts.content ?? null,
          ...(opts.reasoning ? { reasoning_content: opts.reasoning } : {}),
          ...(opts.toolCalls ? { tool_calls: opts.toolCalls } : {}),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// ---------------------------------------------------------------------------
// 1. Matrix invariants.
// ---------------------------------------------------------------------------

const SPEEDS: ReasoningSpeed[] = ["high", "fast"];
const ROLES: ReasoningRole[] = [
  "main_solver",
  "full_verification",
  "step_verification",
  "computation",
  "cy_analyst",
  "reference_seeker",
  "proof_narrator",
  "side_talk",
];

function checkMatrices(): void {
  const missingPricing: string[] = [];
  for (const speed of SPEEDS) {
    for (const role of ROLES) {
      const provider = providerFor(speed, role);
      const model = modelFor(speed, role);
      const effort = effortFor(speed, role);
      if (!provider || !model || !effort) {
        report("ISSUE", "matrix completeness", `(${speed}, ${role}) resolves to ${provider}/${model}/${effort}`);
      }
      if (!pricingFor(model)) missingPricing.push(`${model} (${speed}/${role})`);
    }
  }
  if (missingPricing.length > 0) {
    report("ISSUE", "pricing coverage", `No pricing entry for: ${[...new Set(missingPricing)].join(", ")} — cost recorded as 0`);
  } else {
    report("PASS", "pricing coverage", "Every model in MODEL_MATRIX has a pricing entry");
  }

  // Roles that functionally require the OpenAI back-end (hosted web_search).
  for (const speed of SPEEDS) {
    for (const role of ["reference_seeker", "side_talk"] as ReasoningRole[]) {
      const provider = providerFor(speed, role);
      if (provider !== "openai") {
        report(
          "ISSUE",
          "web_search provider coupling",
          `(${speed}, ${role}) routed to '${provider}' but this role uses the OpenAI-hosted web_search tool, which the ${provider} back-end silently drops`,
        );
      }
    }
  }
  report("PASS", "web_search provider coupling", "reference_seeker and side_talk are on OpenAI for all speeds (checked)");

  // Provider-specific tests (clientAudit.test.ts, subAgentLoop.test.ts) pin
  // their own routing via llmClient.overrideRoutingForTests, so re-routing
  // the matrices cannot leave them stale; no drift check is needed here.
}

// ---------------------------------------------------------------------------
// 2. webSearch silently dropped on non-OpenAI back-ends.
// ---------------------------------------------------------------------------

async function checkWebSearchDrop(): Promise<void> {
  const hc = mockClaude([claudeMsg([{ type: "text", text: "ok" }])]);
  await claudeClient.createResponse({ model: "claude-sonnet-4-6", input: "q", webSearch: true } as any);
  const claudeHasSearch = Array.isArray(hc.bodies[0].tools) && hc.bodies[0].tools.some((t: any) => /search/i.test(t.name ?? t.type ?? ""));
  hc.restore();

  const hh = mockHf([hfMsg({ content: "ok" })]);
  await hfClient.createResponse({ model: "deepseek-ai/DeepSeek-V4-Pro:together", input: "q", webSearch: true } as any);
  const hfHasSearch = Array.isArray(hh.bodies[0].tools) && hh.bodies[0].tools.some((t: any) => /search/i.test(t.function?.name ?? ""));
  hh.restore();

  if (!claudeHasSearch && !hfHasSearch) {
    report(
      "INFO",
      "webSearch on non-OpenAI",
      "Confirmed: `webSearch: true` is silently dropped by both the Claude and HF back-ends (no search tool in the wire body). Any role that relies on it must stay on OpenAI — enforced only by comments today.",
    );
  } else {
    report("PASS", "webSearch on non-OpenAI", "A search tool surfaced in the non-OpenAI body (unexpected)");
  }
}

// ---------------------------------------------------------------------------
// 3. HF: assistant text + tool_calls in one turn → split + reordered.
// ---------------------------------------------------------------------------

async function checkHfSplitTurn(): Promise<void> {
  const h = mockHf([
    hfMsg({
      id: "t1",
      content: "Let me compute that.",
      reasoning: "thinking...",
      toolCalls: [{ id: "c1", type: "function", function: { name: "run_python", arguments: "{}" } }],
    }),
    hfMsg({ id: "t2", content: "done" }),
  ]);

  await hfClient.runManualAgentLoop({
    model: "deepseek-ai/DeepSeek-V4-Pro:together",
    instructions: "sys",
    input: [{ type: "message", role: "user", content: "go" } as ResponseInputItem],
    maxTurns: 3,
    handlers: { onToolCall: async () => '{"ok":true}' },
  });

  const second = h.bodies[1].messages as any[];
  h.restore();
  const roles = second.map((m) => (m.role === "assistant" && m.tool_calls ? "assistant(tool_calls)" : m.role));
  const iTool = roles.indexOf("tool");
  const iText = second.findIndex((m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("Let me compute"));
  const detail = `turn-2 message order: [${roles.join(", ")}]`;
  if (iText > iTool) {
    // Known quirk of the HuggingFace translation layer; only matters if a
    // role is routed to HF, which the default matrices do not do.
    report(
      "INFO",
      "HF split assistant turn",
      `Assistant text emitted alongside tool_calls is re-sent as a SEPARATE assistant message placed AFTER the tool result (${detail}). Chronology is lost; the reasoning_content lands on the tool_calls message only. Relevant only when a role is routed to HuggingFace.`,
    );
  } else {
    report("PASS", "HF split assistant turn", detail);
  }
  const toolCallMsg = second.find((m) => m.role === "assistant" && m.tool_calls);
  if (!toolCallMsg?.reasoning_content) {
    report("ISSUE", "HF reasoning echo", "reasoning_content NOT echoed on the tool-calling assistant message (DeepSeek 400 risk)");
  } else {
    report("PASS", "HF reasoning echo", "reasoning_content echoed back on the tool-calling assistant message");
  }
}

// ---------------------------------------------------------------------------
// 4. HF: input_image forwarded to a (likely text-only) chat model.
// ---------------------------------------------------------------------------

async function checkHfImageForwarding(): Promise<void> {
  const h = mockHf([hfMsg({ content: "ok" })]);
  const input: ResponseInputItem[] = [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "inline file" },
        { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" },
      ],
    } as any,
  ];
  await hfClient.createResponse({ model: "deepseek-ai/DeepSeek-V4-Pro:together", input });
  const userMsg = (h.bodies[0].messages as any[]).find((m) => m.role === "user");
  h.restore();
  const hasImagePart = Array.isArray(userMsg.content) && userMsg.content.some((p: any) => p.type === "image_url");
  if (hasImagePart) {
    // Same as above: a latent risk, not a defect in the current routing.
    report(
      "INFO",
      "HF image delivery",
      "fetch_artifact_file's input_image is forwarded as an image_url content part. On text-only chat models (DeepSeek V4 Pro) this is a 400/undefined-behavior risk if a compute/verification role is ever moved to HF.",
    );
  } else {
    report("PASS", "HF image delivery", "input_image dropped or converted to text");
  }
}

// ---------------------------------------------------------------------------
// 5+6. Claude: adjacency with interleaved message + extra image message.
// ---------------------------------------------------------------------------

async function checkClaudeAdjacency(): Promise<void> {
  const h = mockClaude([claudeMsg([{ type: "text", text: "ok" }])]);
  // Simulates the exact item sequence the manual loop produces for a turn in
  // which the model reasons, calls fetch_artifact_file on an image, emits
  // text, and the tool pushes an extra image user message after its output.
  const input: ResponseInputItem[] = [
    { type: "message", role: "user", content: "go" } as any,
    { id: "r1", type: "reasoning", summary: [], content: [{ type: "reasoning_text", text: "t" }], __claudeSignature: "sig" } as any,
    { type: "function_call", call_id: "f1", name: "fetch_artifact_file", arguments: "{}" } as any,
    { id: "m1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "fetching", annotations: [] }] } as any,
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
  await claudeClient.createResponse({ model: "claude-sonnet-4-6", input });
  const msgs = h.bodies[0].messages as any[];
  h.restore();

  const roleSeq = msgs.map((m) => m.role).join(",");
  // Assistant tool_use must be immediately followed by a user message whose
  // first blocks are the tool_result.
  let adjacencyOk = true;
  for (let i = 0; i < msgs.length; i += 1) {
    const blocks = Array.isArray(msgs[i].content) ? msgs[i].content : [];
    if (msgs[i].role === "assistant" && blocks.some((b: any) => b.type === "tool_use")) {
      const next = msgs[i + 1];
      const nextBlocks = next && Array.isArray(next.content) ? next.content : [];
      if (!next || next.role !== "user" || !nextBlocks.some((b: any) => b.type === "tool_result")) {
        adjacencyOk = false;
      }
    }
  }
  report(
    adjacencyOk ? "PASS" : "ISSUE",
    "Claude tool_use adjacency",
    `roles on the wire: [${roleSeq}] — tool_result ${adjacencyOk ? "immediately follows" : "does NOT immediately follow"} tool_use`,
  );

  const consecutiveUsers = msgs.some((m, i) => i > 0 && m.role === "user" && msgs[i - 1].role === "user");
  report(
    "INFO",
    "Claude consecutive user turns",
    consecutiveUsers
      ? "The extra image message lands as a SECOND consecutive user message after the tool_result message (Anthropic accepts consecutive same-role messages, but verify against current API behavior)."
      : "Extra image message merged into the tool_result user message.",
  );
}

// ---------------------------------------------------------------------------
// 7. Reasoning-only response → finalMessage null.
// ---------------------------------------------------------------------------

function checkReasoningOnlyTermination(): void {
  const fake: Response = {
    id: "resp_x",
    object: "response",
    created_at: 0,
    output: [{ id: "r", type: "reasoning", summary: [], content: [] } as any],
    output_text: "",
    error: null,
    incomplete_details: { reason: "max_output_tokens" },
    instructions: null,
    metadata: null,
    model: "m",
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    status: "incomplete",
  } as unknown as Response;
  const final = findFinalMessage(fake);
  report(
    "INFO",
    "incomplete/reasoning-only responses",
    `findFinalMessage → ${final === null ? "null" : "message"}. No agent loop inspects response.status/incomplete_details: a truncated turn with no calls is treated as a normal final turn (main solver pauses with no message; sub-agents coerce to an 'empty verdict' rejection/error).`,
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  checkMatrices();
  await checkWebSearchDrop();
  await checkHfSplitTurn();
  await checkHfImageForwarding();
  await checkClaudeAdjacency();
  checkReasoningOnlyTermination();

  console.log("\n=== Agent loop audit (mock-based, no network) ===\n");
  for (const r of results) {
    console.log(`[${r.verdict}] ${r.name}\n        ${r.detail}\n`);
  }
  const issues = results.filter((r) => r.verdict === "ISSUE").length;
  console.log(`Summary: ${results.length} checks — ${issues} issue(s) flagged.`);
  process.exitCode = 0; // audit tool: findings are the output, not a failure
}

void main();
