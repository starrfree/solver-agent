import { isAbort } from "../agents/openaiClient";
import { runMainSolverTurn } from "../agents/mainSolverAgent";
import { runWithUsageContext } from "../agents/usageContext";
import { eventBus } from "../events/eventBus";
import { conversationRepo } from "../repositories/conversationRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { ConflictError, NotFoundError } from "../util/errors";
import { logger } from "../util/logger";

interface InFlightRun {
  promise: Promise<void>;
  controller: AbortController;
  /** Set to true when the controller was triggered by `pauseSolverRun`. */
  pauseRequested: boolean;
}

/**
 * In-memory map of conversations currently being solved. Prevents two
 * concurrent runs of the Main Solver Agent on the same conversation, which
 * would otherwise step on each other's ledger writes. The associated
 * `AbortController` lets `pauseSolverRun` interrupt the run mid-turn.
 */
const inFlight = new Map<string, InFlightRun>();

export interface RunOptions {
  /** When true, the run is awaited before returning (useful in tests). */
  await?: boolean;
}

/**
 * Trigger a Main Solver Agent run for `conversationId`. Returns immediately
 * by default and runs the loop in the background; subscribe to the event
 * bus / SSE to follow progress. Re-entrant calls for the same conversation
 * await the existing run instead of starting a second one.
 */
export async function startSolverRun(
  conversationId: string,
  options: RunOptions = {},
): Promise<void> {
  const existing = inFlight.get(conversationId);
  if (existing) {
    if (options.await) await existing.promise;
    return;
  }

  const controller = new AbortController();
  const run: InFlightRun = {
    controller,
    pauseRequested: false,
    promise: Promise.resolve(),
  };
  run.promise = executeRun(conversationId, run).finally(() => {
    if (inFlight.get(conversationId) === run) {
      inFlight.delete(conversationId);
    }
  });
  inFlight.set(conversationId, run);

  if (options.await) {
    await run.promise;
  } else {
    run.promise.catch((err) => {
      logger.error({ err, conversationId }, "Background solver run failed");
    });
  }
}

export function isRunInFlight(conversationId: string): boolean {
  return inFlight.has(conversationId);
}

/**
 * Request the in-flight solver run for `conversationId` to stop. Updates
 * the conversation and ledger to `paused` synchronously and aborts the
 * run; the background task settles shortly after. Safe to call when no
 * run is in flight (no-op aside from possibly flipping a stuck status).
 */
export async function pauseSolverRun(conversationId: string): Promise<void> {
  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) {
    throw new NotFoundError(`Conversation ${conversationId} not found`);
  }
  if (conversation.status === "archived") {
    throw new ConflictError("Cannot pause an archived conversation");
  }
  if (
    conversation.status === "solved" ||
    conversation.status === "failed"
  ) {
    throw new ConflictError(
      `Cannot pause a conversation in '${conversation.status}' state`,
    );
  }

  // Flip statuses first so the UI updates immediately via SSE; the
  // background loop will settle shortly after the abort signal fires.
  await markPaused(conversationId, conversation.ledgerId);

  const run = inFlight.get(conversationId);
  if (run) {
    run.pauseRequested = true;
    run.controller.abort();
    // Wait for the background loop to actually settle so the caller can
    // safely append a follow-up message right after.
    await run.promise.catch(() => undefined);
  }
}

/**
 * Resume a paused / failed (or interrupted) conversation. Marks the
 * conversation back to `active` and starts a fresh solver run that
 * rebuilds its input from MongoDB.
 */
export async function resumeSolverRun(
  conversationId: string,
  options: RunOptions = {},
): Promise<void> {
  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) {
    throw new NotFoundError(`Conversation ${conversationId} not found`);
  }
  if (conversation.status === "archived") {
    throw new ConflictError("Cannot resume an archived conversation");
  }
  if (conversation.status === "solved") {
    throw new ConflictError(
      `Cannot resume a conversation in '${conversation.status}' state`,
    );
  }
  if (inFlight.has(conversationId)) {
    return;
  }
  await markActive(conversationId, conversation.ledgerId);
  await startSolverRun(conversationId, options);
}

async function markPaused(conversationId: string, ledgerId: string): Promise<void> {
  await conversationRepo.setStatus(conversationId, "paused");
  eventBus.emit({
    type: "conversation.status.changed",
    ledgerId,
    conversationId,
    status: "paused",
  });
  const ledger = await ledgerRepo.findById(ledgerId);
  if (ledger && ledger.status === "active") {
    const updated = await ledgerRepo.setStatus(ledgerId, "paused");
    eventBus.emit({
      type: "ledger.status.changed",
      ledgerId: updated._id,
      conversationId,
      status: updated.status,
    });
  }
}

async function markActive(conversationId: string, ledgerId: string): Promise<void> {
  await conversationRepo.setStatus(conversationId, "active");
  eventBus.emit({
    type: "conversation.status.changed",
    ledgerId,
    conversationId,
    status: "active",
  });
  const ledger = await ledgerRepo.findById(ledgerId);
  if (ledger && (ledger.status === "paused" || ledger.status === "failed")) {
    const updated = await ledgerRepo.setStatus(ledgerId, "active");
    eventBus.emit({
      type: "ledger.status.changed",
      ledgerId: updated._id,
      conversationId,
      status: updated.status,
    });
  }
}

async function executeRun(
  conversationId: string,
  run: InFlightRun,
): Promise<void> {
  const conversation = await conversationRepo.findById(conversationId);
  if (!conversation) {
    throw new NotFoundError(`Conversation ${conversationId} not found`);
  }
  const ledger = await ledgerRepo.findById(conversation.ledgerId);
  if (!ledger) {
    throw new NotFoundError(`Ledger ${conversation.ledgerId} not found`);
  }
  if (conversation.status === "archived") {
    throw new ConflictError("Cannot solve an archived conversation");
  }

  const log = logger.child({
    conversationId: conversation._id,
    ledgerId: ledger._id,
  });
  log.info("Solver run starting");

  try {
    // Set the usage-attribution context for the whole run so every nested
    // LLM call (main solver + sub-agents + proof narrator) is recorded.
    const result = await runWithUsageContext(
      { conversationId: conversation._id, ledgerId: ledger._id },
      () =>
        runMainSolverTurn(conversation, ledger, {
          signal: run.controller.signal,
        }),
    );
    if (result.paused) {
      log.info({ turns: result.turns }, "Solver run paused");
      // pauseSolverRun has already updated statuses; nothing more to do.
      return;
    }
    log.info(
      {
        turns: result.turns,
        finalAnswerSubmitted: result.finalAnswerSubmitted,
      },
      "Solver run completed",
    );
  } catch (err) {
    if (run.pauseRequested || isAbort(err)) {
      log.info({ err }, "Solver run aborted (paused)");
      return;
    }
    log.error({ err }, "Solver run failed");
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
        code: "solver_exception",
        message: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

/**
 * Wait for any in-flight runs to settle. Used during graceful shutdown.
 */
export async function drainSolverRuns(): Promise<void> {
  const runs = Array.from(inFlight.values());
  if (runs.length === 0) return;
  logger.info({ count: runs.length }, "Draining in-flight solver runs");
  await Promise.allSettled(runs.map((r) => r.promise));
}

/**
 * Recover from a backend restart that left some conversations marked as
 * `active` in MongoDB without a corresponding in-memory run. Each such
 * conversation (and its ledger, when applicable) is flipped to `paused`
 * so the user can explicitly resume it from the UI.
 */
export async function recoverInterruptedRuns(): Promise<void> {
  const { collections } = await import("../db/mongo");
  const stranded = await collections
    .conversations()
    .find({ status: "active" })
    .project<{ _id: string; ledgerId: string }>({ _id: 1, ledgerId: 1 })
    .toArray();
  if (stranded.length === 0) return;
  logger.info(
    { count: stranded.length },
    "Found interrupted solver runs from a previous process; marking as paused",
  );
  for (const c of stranded) {
    if (inFlight.has(c._id)) continue;
    try {
      await markPaused(c._id, c.ledgerId);
    } catch (err) {
      logger.warn({ err, conversationId: c._id }, "Failed to mark conversation as paused");
    }
  }
}
