import { isAbort } from "../agents/openaiClient";
import { ComputationResult } from "../agents/symbolicAgent";
import { runSymbolicAgent } from "../agents/symbolicAgent";
import { LedgerEntry, LedgerEntryArtifact, ReasoningSpeed } from "../db/types";
import { eventBus, trackAgentActivity } from "../events/eventBus";
import { filesRepo } from "../repositories/filesRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { logger } from "../util/logger";
import { ToolContext, ToolHandler } from "./types";

interface ComputeArgs {
  task: string;
  dependsOn: string[];
}

export function buildComputationContext(deps: LedgerEntry[]): string {
  if (deps.length === 0) return "";
  return deps
    .map((d) => {
      const detailsStr =
        d.content.details && Object.keys(d.content.details).length > 0
          ? `\n  details: ${JSON.stringify(d.content.details)}`
          : "";
      return `[${d._id}] type=${d.type} status=${d.status} :: ${d.content.summary}${detailsStr}`;
    })
    .join("\n");
}

/** Ledger entry type + tool attribution for each computation-style tool. */
const COMPUTATION_TOOL_ENTRY = {
  symbolic_compute: { type: "symbolic_computation", tool: "symbolic" },
  numerical_compute: { type: "numerical_computation", tool: "numerical" },
  cy_analyst_compute: { type: "cy_analyst_computation", tool: "cy_analyst" },
  seek_references: { type: "reference_lookup", tool: "reference_seeker" },
} as const;

export function makeComputationHandler(
  toolName: keyof typeof COMPUTATION_TOOL_ENTRY,
  runner: (args: {
    task: string;
    context?: string;
    reasoningSpeed: ReasoningSpeed;
    signal?: AbortSignal;
  }) => Promise<ComputationResult>,
): ToolHandler {
  const { type: entryType, tool: entryTool } = COMPUTATION_TOOL_ENTRY[toolName];

  return async (ctx: ToolContext, call) => {
    let args: ComputeArgs;
    try {
      args = JSON.parse(call.arguments) as ComputeArgs;
    } catch (err) {
      return JSON.stringify({ ok: false, error: `Invalid JSON: ${(err as Error).message}` });
    }
    if (!args.task) {
      return JSON.stringify({ ok: false, error: "Field 'task' is required." });
    }

    try {
      const deps =
        args.dependsOn && args.dependsOn.length > 0
          ? await ledgerRepo.findEntries(ctx.ledger._id, args.dependsOn)
          : [];
      const context = buildComputationContext(deps);
      const result = await trackAgentActivity(
        {
          ledgerId: ctx.ledger._id,
          conversationId: ctx.conversation._id,
          tool: entryTool,
        },
        () =>
          runner({
            task: args.task,
            reasoningSpeed: ctx.reasoningSpeed,
            ...(context ? { context } : {}),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          }),
      );

      const entry = await ledgerRepo.appendEntry({
        ledgerId: ctx.ledger._id,
        type: entryType,
        status: result.status === "success" ? "accepted" : "rejected",
        dependsOn: args.dependsOn ?? [],
        content: {
          summary: result.summary || `${toolName}: ${args.task.slice(0, 80)}`,
          details: {
            task: args.task,
            result: result.result,
            error: result.error,
            status: result.status,
          },
        },
        tool: entryTool,
        artifacts: {
          ...(result.code ? { code: result.code } : {}),
          ...(result.stdout ? { stdout: result.stdout } : {}),
          ...(result.stderr ? { stderr: result.stderr } : {}),
          ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
          openaiResponseIds: result.openaiResponseIds,
        },
        reasoningSpeed: ctx.reasoningSpeed,
      });

      const fileRefs: LedgerEntryArtifact[] = [];
      for (const a of result.artifacts) {
        if (a.skipped || !a.data) {
          fileRefs.push({
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            skipped: true,
            ...(a.reason ? { reason: a.reason } : {}),
          });
          continue;
        }
        try {
          const file = await filesRepo.create({
            ledgerId: ctx.ledger._id,
            conversationId: ctx.conversation._id,
            entryId: entry._id,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            data: a.data,
          });
          fileRefs.push({
            fileId: file._id,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
          });
        } catch (err) {
          logger.warn(
            { err, name: a.name, entryId: entry._id },
            "Failed to persist generated file",
          );
        }
      }

      let finalEntry: LedgerEntry = entry;
      if (fileRefs.length > 0) {
        finalEntry = await ledgerRepo.setEntryArtifactFiles(entry._id, fileRefs);
      }

      eventBus.emit({
        type: "ledger.entry.added",
        ledgerId: ctx.ledger._id,
        conversationId: ctx.conversation._id,
        entry: finalEntry,
      });

      return JSON.stringify({
        ok: result.status === "success",
        status: result.status,
        entryId: finalEntry._id,
        result: result.result,
        summary: result.summary,
        error: result.error,
        artifacts: fileRefs.map((a) => ({
          fileId: a.fileId ?? null,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          skipped: a.skipped ?? false,
          ...(a.fileId
            ? {
                url: `/api/conversations/${ctx.conversation._id}/files/${a.fileId}`,
              }
            : {}),
        })),
      });
    } catch (err) {
      if (isAbort(err)) throw err;
      logger.error({ err, toolName }, "computation tool dispatch failed");
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export const symbolicComputeHandler: ToolHandler = makeComputationHandler(
  "symbolic_compute",
  runSymbolicAgent,
);
