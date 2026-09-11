import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";

import { env } from "../config/env";
import {
  Conversation,
  ConversationMessage,
  DEFAULT_REASONING_SPEED,
  Ledger,
  LedgerEntry,
} from "../db/types";
import { eventBus, trackAgentActivity } from "../events/eventBus";
import { conversationRepo } from "../repositories/conversationRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { logger } from "../util/logger";
import {
  createResponse,
  effortFor,
  extractAssistantText,
  findFunctionCalls,
  isAbort,
  isMessage,
} from "./llmClient";
import {
  MAIN_SOLVER_CY_ANALYST_NOTE,
  MAIN_SOLVER_PROMPT,
  MAIN_SOLVER_REFERENCE_SEEKER_NOTE,
} from "./systemPrompts";
import { buildMainSolverTools } from "./toolSchemas";
import { cyAnalystComputeHandler } from "../tools/cyAnalystTool";
import { fetchArtifactFileHandler } from "../tools/fetchArtifactFileTool";
import { ledgerAppendEntryHandler, ledgerSupersedeEntryHandler } from "../tools/ledgerTool";
import { numericalComputeHandler } from "../tools/numericalTool";
import { seekReferencesHandler } from "../tools/referenceSeekerTool";
import { symbolicComputeHandler } from "../tools/symbolicTool";
import { verifyStepHandler } from "../tools/stepVerificationTool";
import { verifyFullSolutionHandler } from "../tools/fullVerificationTool";
import type { ToolContext, ToolHandler } from "../tools/types";

export interface RunMainSolverResult {
  finalAssistantMessage: ConversationMessage | null;
  finalAnswerSubmitted: boolean;
  turns: number;
  /** True when the run exited because the orchestrator aborted it. */
  paused?: boolean;
}

export interface RunMainSolverOptions {
  /**
   * Optional abort signal. Checked between turns and forwarded to every
   * `createResponse` call so a pause request from the orchestrator can
   * interrupt the loop quickly.
   */
  signal?: AbortSignal;
}

interface SubmitFinalAnswerArgs {
  answer: string;
  summary: string;
  finalAnswerEntryId: string;
}

interface FinalAnswerCapture {
  answer: string;
  summary: string;
  finalAnswerEntryId: string;
}

export async function runMainSolverTurn(
  conversation: Conversation,
  ledger: Ledger,
  options: RunMainSolverOptions = {},
): Promise<RunMainSolverResult> {
  return trackAgentActivity(
    {
      ledgerId: ledger._id,
      conversationId: conversation._id,
      tool: "main_solver",
    },
    () => runMainSolverTurnInner(conversation, ledger, options),
  );
}

async function runMainSolverTurnInner(
  conversation: Conversation,
  ledger: Ledger,
  options: RunMainSolverOptions,
): Promise<RunMainSolverResult> {
  const messages = await conversationRepo.listMessages(conversation._id);
  const entries = await ledgerRepo.listEntries(ledger._id);

  const reasoningSpeed = conversation.reasoningSpeed ?? DEFAULT_REASONING_SPEED;
  const cyAnalyst = conversation.additionalTools?.cyAnalyst ?? false;
  const referenceSeeker = conversation.additionalTools?.referenceSeeker ?? false;
  const tools = buildMainSolverTools({ cyAnalyst, referenceSeeker });
  const instructions = [
    MAIN_SOLVER_PROMPT,
    ...(cyAnalyst ? [MAIN_SOLVER_CY_ANALYST_NOTE] : []),
    ...(referenceSeeker ? [MAIN_SOLVER_REFERENCE_SEEKER_NOTE] : []),
  ].join("\n\n");
  const signal = options.signal;
  const ctx: ToolContext = {
    conversation,
    ledger,
    extraInputItems: [],
    reasoningSpeed,
    ...(signal ? { signal } : {}),
  };
  const finalAnswer: { value: FinalAnswerCapture | null } = { value: null };

  const handlers: Record<string, ToolHandler> = {
    ledger_append_entry: ledgerAppendEntryHandler,
    ledger_supersede_entry: ledgerSupersedeEntryHandler,
    symbolic_compute: symbolicComputeHandler,
    numerical_compute: numericalComputeHandler,
    cy_analyst_compute: cyAnalystComputeHandler,
    seek_references: seekReferencesHandler,
    verify_step: verifyStepHandler,
    verify_full_solution: verifyFullSolutionHandler,
    fetch_artifact_file: fetchArtifactFileHandler,
    submit_final_answer: async (_ctx, call) =>
      handleSubmitFinalAnswer(call, finalAnswer),
  };

  const input: ResponseInputItem[] = buildInitialInput({
    conversation,
    ledger,
    entries,
    messages,
  });

  let turn = 0;
  let assistantText = "";

  // Computation entries (symbolic/numerical) that have not yet been interpreted
  // by a following 'result' entry. While this set is non-empty the loop blocks
  // every tool call except the interpreting 'result' append (or reading an
  // artifact), so an accepted computation can never be left un-interpreted.
  const pendingComputations = seedPendingComputations(entries);

  // Whether the current candidate has a fresh 'verified' full-verification
  // verdict. submit_final_answer is blocked until this is true, and it is
  // invalidated by any solution-mutating step (new computation, ledger
  // append/supersede, or a step-verification rejection). Seeded from the
  // ledger so a resumed run respects a verification that already happened.
  let fullSolutionVerified = seedFullSolutionVerified(entries);

  while (turn < env.AGENT_MAX_TURNS) {
    if (signal?.aborted) {
      return { finalAssistantMessage: null, finalAnswerSubmitted: false, turns: turn, paused: true };
    }
    turn += 1;
    let response;
    try {
      response = await createResponse({
        reasoningSpeed,
        reasoningRole: "main_solver",
        instructions,
        input,
        tools,
        reasoning: { effort: effortFor(reasoningSpeed, "main_solver"), summary: "auto" },
        store: true,
        promptCacheKey: `main-solver:${conversation._id}`,
        parallelToolCalls: false,
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (isAbort(err)) {
        return {
          finalAssistantMessage: null,
          finalAnswerSubmitted: false,
          turns: turn,
          paused: true,
        };
      }
      throw err;
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
      const lastMessage = response.output.filter(isMessage).pop();
      if (lastMessage) {
        assistantText = extractAssistantText(lastMessage);
      }
      break;
    }

    const pendingExtraInputItems: ResponseInputItem[] = [];
    for (const call of calls) {
      const handler = handlers[call.name];
      const appendArgs =
        call.name === "ledger_append_entry" ? parseAppendArgs(call) : null;
      const isResultAppend = appendArgs?.type === "result";

      // Guard: an accepted computation must be interpreted by a 'result' entry
      // before any other work proceeds. Reading an artifact is allowed so the
      // model can inspect a plot/CSV before writing the interpretation.
      if (
        pendingComputations.size > 0 &&
        !isAllowedWhilePending(call.name, isResultAppend)
      ) {
        const ids = [...pendingComputations].join(", ");
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({
            ok: false,
            error: `Computation(s) ${ids} are not yet interpreted. Append a 'result' entry that explains how the computed result fits the proof and lists ${ids} in dependsOn before calling any other tool.`,
          }),
        });
        continue;
      }

      // Guard: submit_final_answer is only permitted once the current
      // candidate has a fresh 'verified' verdict from verify_full_solution.
      // This is enforced here (not just in the prompt) so a model cannot
      // finalize after a rejection or without ever verifying.
      if (call.name === "submit_final_answer" && !fullSolutionVerified) {
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({
            ok: false,
            error:
              "submit_final_answer is blocked: call verify_full_solution and obtain a 'verified' verdict on the current candidate before submitting. If you changed the solution after the last verification, re-run verify_full_solution.",
          }),
        });
        continue;
      }

      let output: string;
      if (!handler) {
        output = JSON.stringify({
          ok: false,
          error: `Unknown tool '${call.name}'.`,
        });
      } else {
        try {
          output = await handler(ctx, call);
        } catch (err) {
          if (isAbort(err)) {
            return {
              finalAssistantMessage: null,
              finalAnswerSubmitted: false,
              turns: turn,
              paused: true,
            };
          }
          logger.error({ err, tool: call.name }, "Tool handler threw — coercing to tool output");
          output = JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });

      // Track interpretation state: a successful computation becomes pending; a
      // successful 'result' append clears every computation it interprets.
      if (
        call.name === "symbolic_compute" ||
        call.name === "numerical_compute" ||
        call.name === "cy_analyst_compute"
      ) {
        const entryId = parseComputationEntryId(output);
        if (entryId) pendingComputations.add(entryId);
      } else if (isResultAppend && parseOk(output)) {
        for (const dep of appendArgs?.dependsOn ?? []) {
          pendingComputations.delete(dep);
        }
      }

      // Track full-verification freshness. A 'verified' verdict arms
      // submit_final_answer; any solution-mutating step disarms it.
      if (call.name === "verify_full_solution") {
        fullSolutionVerified = parseFullVerificationVerdict(output) === "verified";
      } else if (
        call.name === "symbolic_compute" ||
        call.name === "numerical_compute" ||
        call.name === "cy_analyst_compute" ||
        call.name === "ledger_supersede_entry" ||
        call.name === "ledger_append_entry"
      ) {
        if (parseOk(output)) fullSolutionVerified = false;
      } else if (call.name === "verify_step") {
        if (parseStepVerdict(output) === "rejected") fullSolutionVerified = false;
      }

      if (ctx.extraInputItems.length > 0) {
        for (const extra of ctx.extraInputItems) {
          pendingExtraInputItems.push(extra);
        }
        ctx.extraInputItems.length = 0;
      }

      if (call.name === "submit_final_answer" && finalAnswer.value) {
        return await finalizeRun(ctx, finalAnswer.value, turn);
      }
    }
    if (pendingExtraInputItems.length > 0) {
      input.push(...pendingExtraInputItems);
    }
  }

  // If the loop exited because a pause/abort was requested (e.g. a follow-up
  // message arrived mid-run), the orchestrator / route owns the status
  // transition. Report 'paused' and do NOT write any status or append a
  // stray prose message here, otherwise we'd stomp the re-activation that the
  // follow-up flow performs right after the run settles.
  if (signal?.aborted) {
    return {
      finalAssistantMessage: null,
      finalAnswerSubmitted: false,
      turns: turn,
      paused: true,
    };
  }

  if (turn >= env.AGENT_MAX_TURNS) {
    logger.warn(
      { conversationId: conversation._id, turns: turn },
      "Main solver exhausted max turns",
    );
    await conversationRepo.setStatus(conversation._id, "failed");
    eventBus.emit({
      type: "conversation.status.changed",
      ledgerId: ledger._id,
      conversationId: conversation._id,
      status: "failed",
    });
    eventBus.emit({
      type: "solver.error",
      ledgerId: ledger._id,
      conversationId: conversation._id,
      error: {
        code: "max_turns_exceeded",
        message: `Solver exceeded ${env.AGENT_MAX_TURNS} turns without submitting a final answer.`,
      },
    });
  }

  // The model returned a plain assistant message without calling submit_final_answer.
  // We surface it to the user for transparency, but do NOT mark the conversation solved.
  let assistantMessage: ConversationMessage | null = null;
  if (assistantText.trim()) {
    assistantMessage = await conversationRepo.appendMessage({
      conversationId: conversation._id,
      role: "assistant",
      content: assistantText,
    });
    eventBus.emit({
      type: "conversation.message.added",
      ledgerId: ledger._id,
      conversationId: conversation._id,
      message: assistantMessage,
    });
  }

  // If we exited early (the model stopped with prose instead of submitting a
  // verified answer) rather than exhausting the turn budget, the conversation
  // would otherwise be left stuck in 'active' with no in-flight run. Mark it
  // 'paused' so the user can resume it from the UI. (The max-turns branch
  // above already moved it to 'failed'.)
  if (turn < env.AGENT_MAX_TURNS) {
    await markRunPaused(conversation, ledger);
  }

  return { finalAssistantMessage: assistantMessage, finalAnswerSubmitted: false, turns: turn };
}

/**
 * Flip the conversation (and its still-active ledger) to 'paused' and emit the
 * corresponding status events. Used when a run ends without a submitted final
 * answer so it never lingers in 'active' with no background loop attached.
 * Inlined here (rather than reusing the orchestrator's helper) to avoid a
 * circular import between the solver loop and the orchestrator.
 */
async function markRunPaused(
  conversation: Conversation,
  ledger: Ledger,
): Promise<void> {
  await conversationRepo.setStatus(conversation._id, "paused");
  eventBus.emit({
    type: "conversation.status.changed",
    ledgerId: ledger._id,
    conversationId: conversation._id,
    status: "paused",
  });
  const current = await ledgerRepo.findById(ledger._id);
  if (current && current.status === "active") {
    const updated = await ledgerRepo.setStatus(ledger._id, "paused");
    eventBus.emit({
      type: "ledger.status.changed",
      ledgerId: updated._id,
      conversationId: conversation._id,
      status: updated.status,
    });
  }
}

async function finalizeRun(
  ctx: ToolContext,
  capture: FinalAnswerCapture,
  turn: number,
): Promise<RunMainSolverResult> {
  const message = await conversationRepo.appendMessage({
    conversationId: ctx.conversation._id,
    role: "assistant",
    content: capture.answer,
    relatedEntries: [capture.finalAnswerEntryId],
  });
  eventBus.emit({
    type: "conversation.message.added",
    ledgerId: ctx.ledger._id,
    conversationId: ctx.conversation._id,
    message,
  });
  await conversationRepo.update(ctx.conversation._id, {
    status: "solved",
    title: capture.summary.slice(0, 80),
  });
  eventBus.emit({
    type: "conversation.status.changed",
    ledgerId: ctx.ledger._id,
    conversationId: ctx.conversation._id,
    status: "solved",
  });
  const updatedLedger = await ledgerRepo.setStatus(ctx.ledger._id, "solved");
  eventBus.emit({
    type: "ledger.status.changed",
    ledgerId: updatedLedger._id,
    conversationId: ctx.conversation._id,
    status: updatedLedger.status,
  });

  // The reasoning-process walkthrough is no longer generated automatically
  // here. Once the ledger is solved the user triggers the Proof Narrator on
  // demand from the "Solution" tab (see services/narrativeService).

  return { finalAssistantMessage: message, finalAnswerSubmitted: true, turns: turn };
}

function handleSubmitFinalAnswer(
  call: ResponseFunctionToolCall,
  capture: { value: FinalAnswerCapture | null },
): string {
  let args: SubmitFinalAnswerArgs;
  try {
    args = JSON.parse(call.arguments) as SubmitFinalAnswerArgs;
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Invalid JSON: ${(err as Error).message}` });
  }
  if (!args.answer || !args.finalAnswerEntryId) {
    return JSON.stringify({
      ok: false,
      error: "Fields 'answer' and 'finalAnswerEntryId' are required.",
    });
  }
  capture.value = {
    answer: args.answer,
    summary: args.summary ?? "",
    finalAnswerEntryId: args.finalAnswerEntryId,
  };
  return JSON.stringify({ ok: true, status: "submitted" });
}

/**
 * While there are uninterpreted computations, the only tool calls permitted are
 * the interpreting 'result' append and reading an artifact (so the model can
 * inspect a plot/CSV before writing the interpretation). Everything else is
 * blocked. Exported so the guard's decision is unit-testable.
 */
export function isAllowedWhilePending(
  callName: string,
  isResultAppend: boolean,
): boolean {
  return callName === "fetch_artifact_file" || isResultAppend;
}

/**
 * Identify computation entries that have not yet been interpreted by a later
 * 'result' entry, so the guard survives pauses/resumes. Conservative: a
 * computation is treated as interpreted as soon as ANY later entry references
 * it in dependsOn (this also covers legacy ledgers that interpreted
 * computations with a 'derivation' rather than a 'result').
 */
export function seedPendingComputations(entries: LedgerEntry[]): Set<string> {
  const pending = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (
      e.status !== "accepted" ||
      (e.type !== "symbolic_computation" &&
        e.type !== "numerical_computation" &&
        e.type !== "cy_analyst_computation")
    ) {
      continue;
    }
    const interpreted = entries
      .slice(i + 1)
      .some((later) => later.dependsOn.includes(e._id));
    if (!interpreted) pending.add(e._id);
  }
  return pending;
}

export function parseAppendArgs(
  call: ResponseFunctionToolCall,
): { type?: string; dependsOn: string[] } | null {
  try {
    const obj = JSON.parse(call.arguments) as {
      type?: string;
      dependsOn?: string[];
    };
    return {
      ...(typeof obj.type === "string" ? { type: obj.type } : {}),
      dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn : [],
    };
  } catch {
    return null;
  }
}

export function parseComputationEntryId(output: string): string | null {
  try {
    const obj = JSON.parse(output) as { ok?: boolean; entryId?: string };
    if (obj.ok === true && typeof obj.entryId === "string") return obj.entryId;
    return null;
  } catch {
    return null;
  }
}

export function parseOk(output: string): boolean {
  try {
    return (JSON.parse(output) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

/** Read the verdict out of a verify_full_solution tool output. */
export function parseFullVerificationVerdict(
  output: string,
): "verified" | "rejected" | null {
  try {
    const verdict = (JSON.parse(output) as { verdict?: string }).verdict;
    if (verdict === "verified" || verdict === "rejected") return verdict;
    return null;
  } catch {
    return null;
  }
}

/** Read the verdict out of a verify_step tool output. */
export function parseStepVerdict(
  output: string,
): "accepted" | "rejected" | null {
  try {
    const verdict = (JSON.parse(output) as { verdict?: string }).verdict;
    if (verdict === "accepted" || verdict === "rejected") return verdict;
    return null;
  } catch {
    return null;
  }
}

/**
 * Solution-affecting entry types: appending any of these after a verified
 * full verification invalidates that verdict (the candidate or its supporting
 * chain changed and must be re-verified before submission).
 */
const SOLUTION_MUTATING_TYPES: ReadonlySet<string> = new Set([
  "assumption",
  "derivation",
  "result",
  "correction",
  "symbolic_computation",
  "numerical_computation",
  "cy_analyst_computation",
  "final_answer",
  "problem_followup",
]);

/**
 * Decide, from the persisted ledger alone, whether submit_final_answer should
 * be armed at the start of a (possibly resumed) run: true iff the most recent
 * full-verification entry returned 'verified' and nothing solution-affecting
 * was appended after it. Exported so the gate's seed is unit-testable.
 */
export function seedFullSolutionVerified(entries: LedgerEntry[]): boolean {
  let lastFullIdx = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].tool === "full_verification") {
      lastFullIdx = i;
      break;
    }
  }
  if (lastFullIdx === -1) return false;
  if (entries[lastFullIdx].content.verdict !== "verified") return false;
  for (let i = lastFullIdx + 1; i < entries.length; i += 1) {
    if (SOLUTION_MUTATING_TYPES.has(entries[i].type)) return false;
  }
  return true;
}

interface BuildInitialInputArgs {
  conversation: Conversation;
  ledger: Ledger;
  entries: LedgerEntry[];
  messages: ConversationMessage[];
}

/**
 * Reconstruct the model input from MongoDB on every solver run. The input
 * always starts with a developer message that contains the problem
 * statement and a compact view of the ledger; the conversation messages
 * follow as plain user / assistant turns. Within a single turn the
 * agent loop preserves reasoning and tool items verbatim.
 */
function buildInitialInput(args: BuildInitialInputArgs): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  input.push({
    type: "message",
    role: "developer",
    content: buildLedgerContextBlock(args.conversation, args.ledger, args.entries),
  });
  for (const m of args.messages) {
    if (m.role === "user" || m.role === "assistant") {
      input.push({ type: "message", role: m.role, content: m.content });
    }
  }
  return input;
}

const MAX_LEDGER_ENTRIES_VERBATIM = 100;

function buildLedgerContextBlock(
  conversation: Conversation,
  ledger: Ledger,
  entries: LedgerEntry[],
): string {
  const lines: string[] = [];
  lines.push(`Conversation id: ${conversation._id}`);
  lines.push(
    `Generated files for this conversation are served at /api/conversations/${conversation._id}/files/<fileId>.`,
  );
  lines.push("");
  lines.push(`Problem statement:\n${ledger.problemStatement}`);
  if (ledger.normalizedProblem) {
    lines.push("");
    lines.push(`Normalized problem:\n${ledger.normalizedProblem}`);
  }
  if (entries.length === 0) {
    lines.push("");
    lines.push("Ledger is currently empty.");
    return lines.join("\n");
  }

  const recent = entries.slice(-MAX_LEDGER_ENTRIES_VERBATIM);
  const older = entries.slice(0, entries.length - recent.length);
  if (older.length > 0) {
    const counts = older.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push("");
    lines.push(
      `Ledger summary (older ${older.length} entries omitted): ${summary}`,
    );
  }

  lines.push("");
  lines.push(`Recent ledger entries (${recent.length} of ${entries.length}):`);
  for (const e of recent) {
    lines.push(formatEntryForPrompt(e));
  }
  return lines.join("\n");
}

function formatEntryForPrompt(entry: LedgerEntry): string {
  const dep = entry.dependsOn.length > 0 ? entry.dependsOn.join(", ") : "(none)";
  const detail =
    entry.content.details && Object.keys(entry.content.details).length > 0
      ? ` | details: ${truncate(JSON.stringify(entry.content.details), 400)}`
      : "";
  return `[${entry._id}] type=${entry.type} status=${entry.status} tool=${entry.tool} dependsOn=[${dep}] :: ${entry.content.summary}${detail}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
