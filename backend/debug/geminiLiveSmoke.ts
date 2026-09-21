/**
 * Gemini API live smoke test — OPT-IN, makes REAL (billed) calls.
 *
 * Verifies against the live Gemini Developer API that the exact request
 * patterns used by the agent loops are accepted and that tool context
 * round-trips correctly through the Gemini translation layer:
 *
 *   A. Manual-state loop (main solver / full verification / narrator /
 *      side-talk pattern): reasoning + function_call output items are echoed
 *      back verbatim as input alongside a synthesized function_call_output
 *      (thought signatures must survive the round-trip), with an extra
 *      input_image user message appended after the tool output (the
 *      fetch_artifact_file pattern).
 *   B. previous_response_id loop (step verification / computation sub-agent
 *      pattern, as emulated in-process by geminiClient): only
 *      function_call_output items are sent on the follow-up turn, with a
 *      JSON-schema responseFormat active alongside the function declarations
 *      on every turn.
 *
 * Uses the Flash tier with low thinking and tight output caps; a run costs a
 * fraction of a cent.
 *
 * Run from backend/:  RUN_LIVE=1 npx tsx debug/geminiLiveSmoke.ts
 * Optional:           GEMINI_SMOKE_MODEL=gemini-3.1-pro-preview
 */
/* eslint-disable no-console */
import type {
  FunctionTool,
  ResponseInputItem,
} from "openai/resources/responses/responses";

import * as geminiClient from "../src/agents/geminiClient";
import { env } from "../src/config/env";

if (process.env.RUN_LIVE !== "1") {
  console.log("Skipping live smoke test (set RUN_LIVE=1 to run against the real Gemini API).");
  process.exit(0);
}
if (!env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set in backend/.env");
  process.exit(1);
}

const MODEL = process.env.GEMINI_SMOKE_MODEL ?? "gemini-3.8-flash";

const echoTool: FunctionTool = {
  type: "function",
  name: "echo_number",
  description: "Returns the number given to it. Call it exactly once with n=7, then report the returned value.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["n"],
    properties: { n: { type: "number", description: "The number to echo." } },
  },
};

const verdictSchema = {
  name: "smoke_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: { value: { type: "number" } },
  },
  strict: true,
} as const;

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function manualLoopSmoke(): Promise<void> {
  console.log(`A. manual-state loop on ${MODEL} (function_call + thought-signature echo-back) ...`);
  const input: ResponseInputItem[] = [
    { type: "message", role: "developer", content: "Smoke-test context: the ledger is empty." } as any,
    { type: "message", role: "user", content: "Call echo_number with n=7 and then state the value it returned." } as any,
  ];

  for (let turn = 0; turn < 4; turn += 1) {
    const response = await geminiClient.createResponse({
      model: MODEL,
      instructions: "You are a smoke-test agent. Use the tool as instructed, then answer plainly.",
      input,
      tools: [echoTool],
      reasoning: { effort: "low", summary: "auto" },
      store: true,
      promptCacheKey: "debug-live-smoke",
      parallelToolCalls: false,
      maxOutputTokens: 4_000,
    });
    const u: any = response.usage;
    console.log(
      `   turn ${turn + 1}: ${response.output.map((o) => o.type).join(",")} | tokens in=${u.input_tokens} (cached ${u.input_tokens_details.cached_tokens}) out=${u.output_tokens} (thoughts ${u.output_tokens_details.reasoning_tokens})`,
    );

    for (const item of response.output) {
      if (item.type === "reasoning" || item.type === "function_call" || item.type === "message") {
        input.push(item as ResponseInputItem);
      }
    }
    const calls = geminiClient.findFunctionCalls(response);
    if (calls.length === 0) {
      const final = geminiClient.findFinalMessage(response);
      const text = final ? geminiClient.extractAssistantText(final) : "(none)";
      console.log(`   final message after ${turn + 1} turn(s): ${JSON.stringify(text.slice(0, 120))}`);
      if (turn === 0) throw new Error("manual loop: the model never called the tool");
      if (!/7/.test(text)) throw new Error("manual loop: tool result did not round-trip into the answer");
      console.log("   PASS: function_call replay with thought signature + functionResponse accepted; tool context round-tripped.");
      return;
    }
    for (const call of calls) {
      const sig = (call as any).__geminiThoughtSignature;
      console.log(`   call ${call.name}(${call.arguments}) id=${call.call_id} signature=${sig ? "present" : "MISSING"}`);
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: true, n: 7 }) });
    }
    // fetch_artifact_file pattern: an extra image user message right after the tool output.
    input.push({
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "Inline content of fetched file f1 (1x1 png)." },
        { type: "input_image", image_url: TINY_PNG, detail: "low" },
      ],
    } as any);
  }
  throw new Error("manual loop: no final message within 4 turns");
}

async function previousResponseLoopSmoke(): Promise<void> {
  console.log(`B. previous_response_id loop on ${MODEL} (responseFormat + tools on every turn) ...`);
  let nextInput: string | ResponseInputItem[] =
    "Call echo_number with n=7, then return the value in the required JSON shape.";
  let previousResponseId: string | undefined;

  for (let turn = 0; turn < 4; turn += 1) {
    const response = await geminiClient.createResponse({
      model: MODEL,
      instructions: "You are a smoke-test agent. Use the tool, then answer in the JSON schema.",
      input: nextInput,
      tools: [echoTool],
      reasoning: { effort: "low", summary: "auto" },
      responseFormat: verdictSchema as any,
      ...(previousResponseId ? { previousResponseId } : {}),
      store: true,
      promptCacheKey: "debug-live-smoke-prev",
      parallelToolCalls: false,
      maxOutputTokens: 4_000,
    });
    previousResponseId = response.id;
    console.log(`   turn ${turn + 1}: ${response.output.map((o) => o.type).join(",")}`);

    const calls = geminiClient.findFunctionCalls(response);
    if (calls.length === 0) {
      const final = geminiClient.findFinalMessage(response);
      const text = final ? geminiClient.extractAssistantText(final) : "";
      console.log(`   final structured message after ${turn + 1} turn(s): ${JSON.stringify(text.slice(0, 120))}`);
      if (turn === 0) throw new Error("previous_response_id loop: the model never called the tool");
      const parsed = JSON.parse(text) as { value?: number };
      if (parsed.value !== 7) throw new Error("previous_response_id loop: schema output did not carry the tool result");
      console.log("   PASS: emulated previous_response_id chaining with responseFormat + tools works; tool context intact.");
      return;
    }
    const followUp: ResponseInputItem[] = [];
    for (const call of calls) {
      followUp.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: true, n: 7 }) });
    }
    nextInput = followUp;
  }
  throw new Error("previous_response_id loop: no final message within 4 turns");
}

async function main(): Promise<void> {
  await manualLoopSmoke();
  await previousResponseLoopSmoke();
  console.log("\nAll live smoke checks passed.");
}

main().catch((err) => {
  console.error("\nLIVE SMOKE FAILURE:", err?.status ?? "", err?.message ?? err);
  process.exit(1);
});
