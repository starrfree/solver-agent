import { LedgerEntryStatus, LedgerEntryType } from "../db/types";
import { eventBus } from "../events/eventBus";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { logger } from "../util/logger";
import { ToolContext, ToolHandler } from "./types";

interface LedgerAppendEntryArgs {
  type: LedgerEntryType;
  status: LedgerEntryStatus;
  summary: string;
  details: string;
  dependsOn: string[];
}

export const ledgerAppendEntryHandler: ToolHandler = async (ctx, call) => {
  let args: LedgerAppendEntryArgs;
  try {
    args = JSON.parse(call.arguments) as LedgerAppendEntryArgs;
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: `Invalid JSON: ${(err as Error).message}`,
    });
  }

  if (!args.summary || !args.type || !args.status) {
    return JSON.stringify({
      ok: false,
      error: "Fields 'type', 'status' and 'summary' are required.",
    });
  }
  if (
    args.type === "symbolic_computation" ||
    args.type === "numerical_computation" ||
    args.type === "cy_analyst_computation"
  ) {
    return JSON.stringify({
      ok: false,
      error:
        "Computation entries are added automatically by the symbolic/numerical/cy_analyst compute tools — do not duplicate them via ledger_append_entry.",
    });
  }
  if (args.type === "problem_followup") {
    return JSON.stringify({
      ok: false,
      error:
        "problem_followup entries are appended automatically by the platform when the user posts a follow-up message — do not create them yourself.",
    });
  }
  if (args.type === "result" && (!args.dependsOn || args.dependsOn.length === 0)) {
    return JSON.stringify({
      ok: false,
      error:
        "A 'result' entry must reference the computation it interprets — list the symbolic_computation/numerical_computation entry id in dependsOn.",
    });
  }

  try {
    const entry = await ledgerRepo.appendEntry({
      ledgerId: ctx.ledger._id,
      type: args.type,
      status: args.status,
      dependsOn: args.dependsOn ?? [],
      content: {
        summary: args.summary,
        details: { body: args.details ?? "" },
      },
      tool: "main_solver",
      reasoningSpeed: ctx.reasoningSpeed,
    });
    eventBus.emit({
      type: "ledger.entry.added",
      ledgerId: ctx.ledger._id,
      conversationId: ctx.conversation._id,
      entry,
    });
    if (args.type === "final_answer") {
      const updated = await ledgerRepo.setFinalAnswer(ctx.ledger._id, args.details ?? args.summary);
      eventBus.emit({
        type: "ledger.final_answer.set",
        ledgerId: ctx.ledger._id,
        conversationId: ctx.conversation._id,
        finalAnswer: updated.finalAnswer ?? "",
      });
    }
    return JSON.stringify({ ok: true, entryId: entry._id });
  } catch (err) {
    logger.error({ err }, "ledger_append_entry failed");
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

interface LedgerSupersedeArgs {
  entryId: string;
  replacedByEntryId: string;
  reason: string;
}

export const ledgerSupersedeEntryHandler: ToolHandler = async (
  ctx: ToolContext,
  call,
) => {
  let args: LedgerSupersedeArgs;
  try {
    args = JSON.parse(call.arguments) as LedgerSupersedeArgs;
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: `Invalid JSON: ${(err as Error).message}`,
    });
  }

  try {
    const existing = await ledgerRepo.findEntry(args.entryId);
    if (!existing) {
      return JSON.stringify({
        ok: false,
        error: `Entry ${args.entryId} not found.`,
      });
    }
    if (existing.ledgerId !== ctx.ledger._id) {
      return JSON.stringify({
        ok: false,
        error: `Entry ${args.entryId} does not belong to this ledger.`,
      });
    }
    const updated = await ledgerRepo.setEntryStatus(args.entryId, "superseded");
    eventBus.emit({
      type: "ledger.entry.updated",
      ledgerId: ctx.ledger._id,
      conversationId: ctx.conversation._id,
      entry: updated,
    });
    return JSON.stringify({
      ok: true,
      entryId: updated._id,
      status: updated.status,
      replacedBy: args.replacedByEntryId,
      reason: args.reason,
    });
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
