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
  LedgerEntryArtifact,
  SideTalkArtifactRef,
  SideTalkEntryRef,
  SideTalkMessage,
} from "../db/types";
import { fetchArtifactFileHandler } from "../tools/fetchArtifactFileTool";
import { getLedgerEntriesHandler } from "../tools/getLedgerEntriesTool";
import type { ToolContext, ToolHandler } from "../tools/types";
import { logger } from "../util/logger";
import {
  createResponse,
  effortFor,
  extractAssistantText,
  findFinalMessage,
  findFunctionCalls,
} from "./llmClient";
import { SIDE_TALK_PROMPT, SIDE_TALK_WEB_SEARCH_NOTE } from "./systemPrompts";
import { sideTalkTools } from "./toolSchemas";

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_ledger_entries: getLedgerEntriesHandler,
  fetch_artifact_file: fetchArtifactFileHandler,
};

export interface RunSideTalkInput {
  conversation: Conversation;
  ledger: Ledger;
  entries: LedgerEntry[];
  /** Prior side-talk turns, oldest first. */
  history: SideTalkMessage[];
  /** Main conversation turns (read-only). */
  messages: ConversationMessage[];
  /** The new question being asked. */
  question: string;
  /** When true, expose OpenAI's hosted web_search tool to the model. */
  webSearch?: boolean;
}

export interface RunSideTalkResult {
  /** Assistant reply text (empty string if the model produced nothing usable). */
  text: string;
  /** Ledger entries the model pulled via get_ledger_entries, in load order. */
  loadedEntries: SideTalkEntryRef[];
  /** Files the model loaded via fetch_artifact_file, in load order. */
  loadedArtifacts: SideTalkArtifactRef[];
}

/**
 * Answer an off-the-record question about the ongoing work. The model has two
 * read-only tools — get_ledger_entries and fetch_artifact_file — so it can pull
 * the complete content of a step or load a generated file before answering. It
 * has no write or computation tools: it never touches the ledger, never runs
 * code, and never goes through the solver orchestrator.
 *
 * Returns the reply plus the entries/files the model actually loaded, so the UI
 * can surface clickable flags that jump to the entry or open it in the
 * artifacts panel.
 */
export async function runSideTalk(
  input: RunSideTalkInput,
): Promise<RunSideTalkResult> {
  const speed = input.conversation.reasoningSpeed ?? DEFAULT_REASONING_SPEED;

  const ctx: ToolContext = {
    conversation: input.conversation,
    ledger: input.ledger,
    extraInputItems: [],
    reasoningSpeed: speed,
  };

  // Index entries and their files so we can map loaded ids back to the
  // metadata the UI needs (entry type/summary, owning entry for a file).
  const entryById = new Map(input.entries.map((e) => [e._id, e]));
  const fileOwner = new Map<
    string,
    { entry: LedgerEntry; file: LedgerEntryArtifact }
  >();
  for (const e of input.entries) {
    for (const f of e.artifacts?.files ?? []) {
      if (f.fileId) fileOwner.set(f.fileId, { entry: e, file: f });
    }
  }

  const loadedEntries: SideTalkEntryRef[] = [];
  const seenEntry = new Set<string>();
  const loadedArtifacts: SideTalkArtifactRef[] = [];
  const seenFile = new Set<string>();

  const recordEntry = (entryId: string): void => {
    if (seenEntry.has(entryId)) return;
    const entry = entryById.get(entryId);
    if (!entry) return;
    seenEntry.add(entryId);
    loadedEntries.push({
      entryId: entry._id,
      entryType: entry.type,
      summary: entry.content.summary,
    });
  };

  const recordFile = (fileId: string): void => {
    if (seenFile.has(fileId)) return;
    const owner = fileOwner.get(fileId);
    if (!owner) return; // Can't open the panel without the owning entry.
    seenFile.add(fileId);
    loadedArtifacts.push({
      fileId,
      entryId: owner.entry._id,
      name: owner.file.name,
      mimeType: owner.file.mimeType,
    });
  };

  const inputItems: ResponseInputItem[] = [
    {
      type: "message",
      role: "developer",
      content: buildContextBlock(input),
    },
  ];

  for (const m of input.messages) {
    if (m.role === "user" || m.role === "assistant") {
      inputItems.push({ type: "message", role: m.role, content: m.content });
    }
  }
  for (const m of input.history) {
    inputItems.push({ type: "message", role: m.role, content: m.content });
  }
  inputItems.push({ type: "message", role: "user", content: input.question });

  const instructions = input.webSearch
    ? `${SIDE_TALK_PROMPT}\n\n${SIDE_TALK_WEB_SEARCH_NOTE}`
    : SIDE_TALK_PROMPT;

  for (let turn = 0; turn < env.SUB_AGENT_MAX_TURNS; turn += 1) {
    const response = await createResponse({
      reasoningSpeed: speed,
      reasoningRole: "side_talk",
      instructions,
      input: inputItems,
      tools: sideTalkTools,
      webSearch: input.webSearch ?? false,
      reasoning: { effort: effortFor(speed, "side_talk"), summary: "auto" },
      store: true,
      promptCacheKey: `side-talk:${input.conversation._id}`,
      parallelToolCalls: false,
    });

    for (const item of response.output) {
      if (
        item.type === "reasoning" ||
        item.type === "function_call" ||
        item.type === "message" ||
        // Hosted web_search runs server-side; re-feed its call items so any
        // reasoning that references them stays valid across turns.
        item.type === "web_search_call"
      ) {
        inputItems.push(item as ResponseInputItem);
      }
    }

    const calls = findFunctionCalls(response);
    if (calls.length === 0) {
      const final = findFinalMessage(response);
      return {
        text: final ? extractAssistantText(final) : "",
        loadedEntries,
        loadedArtifacts,
      };
    }

    const pendingExtraInputItems: ResponseInputItem[] = [];
    for (const call of calls) {
      const output = await dispatchTool(ctx, call);
      recordReferences(call, output, recordEntry, recordFile);
      inputItems.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
      if (ctx.extraInputItems.length > 0) {
        pendingExtraInputItems.push(...ctx.extraInputItems);
        ctx.extraInputItems.length = 0;
      }
    }
    if (pendingExtraInputItems.length > 0) {
      inputItems.push(...pendingExtraInputItems);
    }
  }

  logger.warn(
    { conversationId: input.conversation._id },
    "Side-talk exhausted max turns without producing a reply",
  );
  return { text: "", loadedEntries, loadedArtifacts };
}

async function dispatchTool(
  ctx: ToolContext,
  call: ResponseFunctionToolCall,
): Promise<string> {
  const handler = TOOL_HANDLERS[call.name];
  if (!handler) {
    return JSON.stringify({ ok: false, error: `Unknown tool '${call.name}'.` });
  }
  return handler(ctx, call);
}

/**
 * Inspect a tool call's output and record which ledger entries / files it
 * successfully surfaced, so they can be flagged on the assistant message.
 */
function recordReferences(
  call: ResponseFunctionToolCall,
  output: string,
  recordEntry: (entryId: string) => void,
  recordFile: (fileId: string) => void,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const result = parsed as Record<string, unknown>;
  if (result.ok === false) return;

  if (call.name === "get_ledger_entries" && Array.isArray(result.entries)) {
    for (const entry of result.entries) {
      if (entry && typeof entry === "object") {
        const id = (entry as Record<string, unknown>).id;
        if (typeof id === "string") recordEntry(id);
      }
    }
  } else if (
    call.name === "fetch_artifact_file" &&
    typeof result.fileId === "string"
  ) {
    recordFile(result.fileId);
  }
}

const MAX_LEDGER_ENTRIES_VERBATIM = 100;

function buildContextBlock(input: RunSideTalkInput): string {
  const { conversation, ledger, entries } = input;
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
  lines.push("");
  lines.push(`Current status: ${ledger.status}.`);
  if (ledger.finalAnswer) {
    lines.push("");
    lines.push(`Final answer (already produced by the solver):\n${ledger.finalAnswer}`);
  }

  if (entries.length === 0) {
    lines.push("");
    lines.push("The reasoning record is currently empty — no steps have been taken yet.");
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
    lines.push(`Earlier reasoning steps (older ${older.length} omitted): ${summary}`);
  }

  lines.push("");
  lines.push(
    `Recent reasoning steps (${recent.length} of ${entries.length}). Each is tagged with a bracketed id you can pass to get_ledger_entries for the complete, untruncated content and any attached files:`,
  );
  for (const e of recent) {
    lines.push(formatEntryForPrompt(e));
  }
  return lines.join("\n");
}

function formatEntryForPrompt(entry: LedgerEntry): string {
  const detail =
    entry.content.details && Object.keys(entry.content.details).length > 0
      ? ` | details: ${truncate(JSON.stringify(entry.content.details), 400)}`
      : "";
  return `- [${entry._id}] type=${entry.type} status=${entry.status} :: ${entry.content.summary}${detail}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
