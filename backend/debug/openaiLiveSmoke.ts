/**
 * OpenAI Responses API live smoke test — OPT-IN, makes REAL (billed) calls.
 *
 * Verifies against the live API that the exact request patterns used by the
 * agent loops are accepted and that tool context round-trips correctly:
 *
 *   A. Manual-state loop (main solver / full verification / narrator /
 *      side-talk pattern): reasoning + function_call output items are echoed
 *      back verbatim as input alongside a synthesized function_call_output,
 *      with instructions + store + prompt_cache_key set.
 *   B. previous_response_id loop (step verification / computation sub-agent
 *      pattern): only function_call_output items are sent on the follow-up
 *      turn, with a strict json_schema responseFormat active on every turn.
 *   C. Extra input_image user message appended after a function_call_output
 *      (the fetch_artifact_file pattern) is accepted mid-loop.
 *
 * Uses the cheap fast-tier model with low effort and tight output caps; a run
 * costs well under a cent.
 *
 * Run from backend/:  RUN_LIVE=1 npx tsx debug/openaiLiveSmoke.ts
 */
/* eslint-disable no-console */
import type {
  FunctionTool,
  ResponseInputItem,
} from "openai/resources/responses/responses";

import * as openaiClient from "../src/agents/openaiClient";

if (process.env.RUN_LIVE !== "1") {
  console.log("Skipping live smoke test (set RUN_LIVE=1 to run against the real OpenAI API).");
  process.exit(0);
}

const MODEL = "gpt-5.6-luna";

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
  console.log("A. manual-state loop (reasoning + function_call echo-back) ...");
  const input: ResponseInputItem[] = [
    { type: "message", role: "developer", content: "Smoke-test context: the ledger is empty." } as any,
    { type: "message", role: "user", content: "Call echo_number with n=7 and then state the value it returned." } as any,
  ];

  for (let turn = 0; turn < 4; turn += 1) {
    const response = await openaiClient.createResponse({
      model: MODEL,
      instructions: "You are a smoke-test agent. Use the tool as instructed, then answer plainly.",
      input,
      tools: [echoTool],
      reasoning: { effort: "low", summary: "auto" },
      store: true,
      promptCacheKey: "debug-live-smoke",
      parallelToolCalls: false,
      maxOutputTokens: 2_000,
    });

    for (const item of response.output) {
      if (item.type === "reasoning" || item.type === "function_call" || item.type === "message") {
        input.push(item as ResponseInputItem);
      }
    }
    const calls = openaiClient.findFunctionCalls(response);
    if (calls.length === 0) {
      const final = openaiClient.findFinalMessage(response);
      const text = final ? openaiClient.extractAssistantText(final) : "(none)";
      console.log(`   final message after ${turn + 1} turn(s): ${JSON.stringify(text.slice(0, 120))}`);
      if (!/7/.test(text)) throw new Error("manual loop: tool result did not round-trip into the answer");
      console.log("   PASS: reasoning/function_call replay + function_call_output accepted; tool context round-tripped.");
      return;
    }
    for (const call of calls) {
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: true, n: 7 }) });
    }
    // C. fetch_artifact_file pattern: an extra image user message right after the tool output.
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
  console.log("B. previous_response_id loop (responseFormat + tools on every turn) ...");
  let nextInput: string | ResponseInputItem[] =
    "Call echo_number with n=7, then return the value in the required JSON shape.";
  let previousResponseId: string | undefined;

  for (let turn = 0; turn < 4; turn += 1) {
    const response = await openaiClient.createResponse({
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
      maxOutputTokens: 2_000,
    });
    previousResponseId = response.id;

    const calls = openaiClient.findFunctionCalls(response);
    if (calls.length === 0) {
      const final = openaiClient.findFinalMessage(response);
      const text = final ? openaiClient.extractAssistantText(final) : "";
      console.log(`   final structured message after ${turn + 1} turn(s): ${JSON.stringify(text.slice(0, 120))}`);
      const parsed = JSON.parse(text) as { value?: number };
      if (parsed.value !== 7) throw new Error("previous_response_id loop: schema output did not carry the tool result");
      console.log("   PASS: previous_response_id chaining with responseFormat + tools works; server-side tool context intact.");
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
  if (err?.error) console.error("API error payload:", JSON.stringify(err.error, null, 2));
  process.exit(1);
});
