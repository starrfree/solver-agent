import { runFullVerificationAgent } from "../agents/fullVerificationAgent";
import { isAbort } from "../agents/openaiClient";
import { eventBus, trackAgentActivity } from "../events/eventBus";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { logger } from "../util/logger";
import { ToolContext, ToolHandler } from "./types";

interface VerifyFullArgs {
  candidateAnswer: string;
}

export const verifyFullSolutionHandler: ToolHandler = async (
  ctx: ToolContext,
  call,
) => {
  let args: VerifyFullArgs;
  try {
    args = JSON.parse(call.arguments) as VerifyFullArgs;
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Invalid JSON: ${(err as Error).message}` });
  }
  if (!args.candidateAnswer) {
    return JSON.stringify({
      ok: false,
      error: "Field 'candidateAnswer' is required.",
    });
  }

  try {
    const ledger = await ledgerRepo.requireById(ctx.ledger._id);
    const entries = await ledgerRepo.listEntries(ledger._id);
    const verdict = await trackAgentActivity(
      {
        ledgerId: ctx.ledger._id,
        conversationId: ctx.conversation._id,
        tool: "full_verification",
      },
      () =>
        runFullVerificationAgent(
          {
            ledger,
            entries,
            candidateAnswer: args.candidateAnswer,
          },
          ctx,
        ),
    );

    const verificationEntry = await ledgerRepo.appendEntry({
      ledgerId: ledger._id,
      type: "verification",
      status: verdict.verdict === "verified" ? "accepted" : "rejected",
      dependsOn: entries.map((e) => e._id),
      content: {
        summary: `Full verification: ${verdict.verdict}`,
        verdict: verdict.verdict,
        justification: verdict.summary,
        details: {
          issues: verdict.issues,
          candidateAnswer: args.candidateAnswer,
        },
      },
      tool: "full_verification",
      artifacts: { openaiResponseIds: verdict.openaiResponseIds },
      reasoningSpeed: ctx.reasoningSpeed,
    });
    eventBus.emit({
      type: "ledger.entry.added",
      ledgerId: ledger._id,
      conversationId: ctx.conversation._id,
      entry: verificationEntry,
    });

    if (verdict.verdict === "verified") {
      const updated = await ledgerRepo.setStatus(ledger._id, "verified");
      eventBus.emit({
        type: "ledger.status.changed",
        ledgerId: updated._id,
        conversationId: ctx.conversation._id,
        status: updated.status,
      });
    }

    return JSON.stringify({
      ok: true,
      verdict: verdict.verdict,
      summary: verdict.summary,
      verificationEntryId: verificationEntry._id,
      issues: verdict.issues,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    logger.error({ err }, "verify_full_solution failed");
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
