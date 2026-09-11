import { isAbort } from "../agents/openaiClient";
import { runStepVerificationAgent } from "../agents/stepVerificationAgent";
import { eventBus, trackAgentActivity } from "../events/eventBus";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { logger } from "../util/logger";
import { ToolContext, ToolHandler } from "./types";

interface VerifyStepArgs {
  entryId: string;
  focus: string;
}

export const verifyStepHandler: ToolHandler = async (
  ctx: ToolContext,
  call,
) => {
  let args: VerifyStepArgs;
  try {
    args = JSON.parse(call.arguments) as VerifyStepArgs;
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Invalid JSON: ${(err as Error).message}` });
  }
  if (!args.entryId) {
    return JSON.stringify({ ok: false, error: "Field 'entryId' is required." });
  }

  try {
    const target = await ledgerRepo.findEntry(args.entryId);
    if (!target || target.ledgerId !== ctx.ledger._id) {
      return JSON.stringify({
        ok: false,
        error: `Entry ${args.entryId} not found in this ledger.`,
      });
    }
    const dependencies =
      target.dependsOn.length > 0
        ? await ledgerRepo.findEntries(ctx.ledger._id, target.dependsOn)
        : [];

    const verdict = await trackAgentActivity(
      {
        ledgerId: ctx.ledger._id,
        conversationId: ctx.conversation._id,
        tool: "step_verification",
      },
      () =>
        runStepVerificationAgent(
          {
            target,
            dependencies,
            focus: args.focus ?? "",
          },
          ctx,
        ),
    );

    const verificationEntry = await ledgerRepo.appendEntry({
      ledgerId: ctx.ledger._id,
      type: "verification",
      status: verdict.verdict === "accepted" ? "accepted" : "rejected",
      dependsOn: [target._id, ...target.dependsOn],
      content: {
        summary: `Step verification of ${target._id}: ${verdict.verdict}`,
        verdict: verdict.verdict,
        justification: verdict.justification,
        details: {
          targetEntryId: target._id,
          method: verdict.method,
          counterExample: verdict.counterExample,
          focus: args.focus,
        },
      },
      tool: "step_verification",
      artifacts: { openaiResponseIds: verdict.openaiResponseIds },
      reasoningSpeed: ctx.reasoningSpeed,
    });
    eventBus.emit({
      type: "ledger.entry.added",
      ledgerId: ctx.ledger._id,
      conversationId: ctx.conversation._id,
      entry: verificationEntry,
    });

    if (verdict.verdict === "rejected" && target.status === "accepted") {
      const updated = await ledgerRepo.setEntryStatus(target._id, "rejected");
      eventBus.emit({
        type: "ledger.entry.updated",
        ledgerId: ctx.ledger._id,
        conversationId: ctx.conversation._id,
        entry: updated,
      });
    }

    return JSON.stringify({
      ok: true,
      verdict: verdict.verdict,
      verificationEntryId: verificationEntry._id,
      justification: verdict.justification,
      method: verdict.method,
      counterExample: verdict.counterExample,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    logger.error({ err }, "verify_step failed");
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
