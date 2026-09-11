import { isAbort } from "../agents/openaiClient";
import { runProofNarratorAgent } from "../agents/proofNarratorAgent";
import { runWithUsageContext } from "../agents/usageContext";
import { DEFAULT_REASONING_SPEED } from "../db/types";
import { eventBus, trackAgentActivity } from "../events/eventBus";
import { conversationRepo } from "../repositories/conversationRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import type { ToolContext } from "../tools/types";
import { ConflictError, NotFoundError } from "../util/errors";
import { logger } from "../util/logger";

/**
 * Conversations whose proof-narrator walkthrough is currently being (re)built.
 * Guards against two concurrent generations racing on the same ledger write.
 */
const inFlight = new Set<string>();

export function isNarrativeInFlight(conversationId: string): boolean {
  return inFlight.has(conversationId);
}

/**
 * Kick off a proof-narrator run for `conversationId` and return immediately;
 * progress is delivered over the event bus / SSE (`agent.activity` while it
 * runs, `ledger.narrative.set` when it lands). Only allowed once the ledger is
 * solved. A regenerate simply reruns the narrator from the ledger — it never
 * receives the previously generated walkthrough, so each run is built afresh
 * from the verified reasoning chain alone.
 */
export async function startNarrativeGeneration(
  conversationId: string,
): Promise<void> {
  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) {
    throw new NotFoundError(`Conversation ${conversationId} not found`);
  }
  const ledger = await ledgerRepo.findById(conversation.ledgerId);
  if (!ledger) {
    throw new NotFoundError(`Ledger ${conversation.ledgerId} not found`);
  }
  if (ledger.status !== "solved" && ledger.status !== "verified") {
    throw new ConflictError(
      "The solution walkthrough can only be generated once the problem is solved",
    );
  }
  if (inFlight.has(conversationId)) {
    throw new ConflictError(
      "A solution walkthrough is already being generated for this conversation",
    );
  }

  inFlight.add(conversationId);
  const promise = generateNarrative(conversation._id, ledger._id).finally(() => {
    inFlight.delete(conversationId);
  });
  promise.catch((err) => {
    logger.error(
      { err, conversationId },
      "Background narrative generation failed",
    );
  });
}

async function generateNarrative(
  conversationId: string,
  ledgerId: string,
): Promise<void> {
  const log = logger.child({ conversationId, ledgerId });
  log.info("Proof narrator run starting");

  const conversation = await conversationRepo.requireById(conversationId);
  const ledger = await ledgerRepo.requireById(ledgerId);
  const entries = await ledgerRepo.listEntries(ledger._id);
  const finalAnswer = ledger.finalAnswer ?? (await lastAssistantAnswer(conversationId));

  const ctx: ToolContext = {
    conversation,
    ledger,
    extraInputItems: [],
    reasoningSpeed: conversation.reasoningSpeed ?? DEFAULT_REASONING_SPEED,
  };

  try {
    const narrative = await runWithUsageContext(
      { conversationId: conversation._id, ledgerId: ledger._id },
      () =>
        trackAgentActivity(
          {
            ledgerId: ledger._id,
            conversationId: conversation._id,
            tool: "proof_narrator",
          },
          () =>
            runProofNarratorAgent(
              {
                ledger,
                entries,
                conversationId: conversation._id,
                finalAnswer,
              },
              ctx,
            ),
        ),
    );
    if (!narrative.trim()) {
      log.warn("Proof narrator returned empty output; not persisting");
      eventBus.emit({
        type: "solver.error",
        ledgerId: ledger._id,
        conversationId: conversation._id,
        error: {
          code: "narrator_empty",
          message: "The narrator produced no walkthrough. Please try again.",
        },
      });
      return;
    }
    await ledgerRepo.setNarrative(ledger._id, narrative);
    eventBus.emit({
      type: "ledger.narrative.set",
      ledgerId: ledger._id,
      conversationId: conversation._id,
      narrative,
    });
    log.info("Proof narrator run completed");
  } catch (err) {
    if (isAbort(err)) {
      log.info({ err }, "Proof narrator run aborted");
      return;
    }
    log.error({ err }, "Proof narrator run failed");
    eventBus.emit({
      type: "solver.error",
      ledgerId: ledger._id,
      conversationId: conversation._id,
      error: {
        code: "narrator_exception",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * Fallback for legacy ledgers whose `finalAnswer` was never persisted: use the
 * last assistant message as the verified answer for the narrator's context.
 */
async function lastAssistantAnswer(conversationId: string): Promise<string> {
  const messages = await conversationRepo.listMessages(conversationId);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return messages[i].content;
  }
  return "";
}
