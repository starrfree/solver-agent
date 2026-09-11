import { Router } from "express";
import { z } from "zod";

import { conversationRepo } from "../repositories/conversationRepo";
import { filesRepo } from "../repositories/filesRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { sideTalkRepo } from "../repositories/sideTalkRepo";
import { usageRepo } from "../repositories/usageRepo";
import { eventBus } from "../events/eventBus";
import { forkConversation } from "../services/forkConversation";
import { startNarrativeGeneration } from "../services/narrativeService";
import {
  isRunInFlight,
  pauseSolverRun,
  resumeSolverRun,
  startSolverRun,
} from "../services/solverOrchestrator";
import { asyncHandler, pathParam } from "../util/asyncHandler";
import { BadRequestError, ConflictError } from "../util/errors";
import { ids } from "../util/ids";
import { logger } from "../util/logger";

const router = Router();

const ListQuery = z.object({
  userId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError("Invalid query", parsed.error.issues);
    }
    const list = await conversationRepo.listByUser(
      parsed.data.userId,
      parsed.data.limit,
    );
    res.json({ conversations: list });
  }),
);

const ReasoningSpeedSchema = z.enum(["high", "fast"]);

const AdditionalToolsSchema = z.object({
  cyAnalyst: z.boolean().optional(),
  referenceSeeker: z.boolean().optional(),
});

const CreateBody = z.object({
  userId: z.string().min(1),
  problemStatement: z.string().min(1),
  title: z.string().min(1).optional(),
  reasoningSpeed: ReasoningSpeedSchema.optional(),
  additionalTools: AdditionalToolsSchema.optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Invalid body", parsed.error.issues);
    }
    const { conversation, ledger } = await createConversationAndLedger({
      userId: parsed.data.userId,
      problemStatement: parsed.data.problemStatement,
      title: parsed.data.title,
      reasoningSpeed: parsed.data.reasoningSpeed,
      additionalTools: parsed.data.additionalTools,
    });

    const userMessage = await conversationRepo.appendMessage({
      conversationId: conversation._id,
      role: "user",
      content: parsed.data.problemStatement,
    });
    eventBus.emit({
      type: "conversation.message.added",
      ledgerId: ledger._id,
      conversationId: conversation._id,
      message: userMessage,
    });

    void startSolverRun(conversation._id);

    res.status(201).json({
      conversationId: conversation._id,
      ledgerId: ledger._id,
      problemId: conversation.problemId,
    });
  }),
);

const ForkBody = z.object({
  /** ISO timestamp of the timeline item the fork branches from (inclusive). */
  upToCreatedAt: z.string().datetime(),
  title: z.string().min(1).optional(),
  /** Mark the fork `solved` (forking from the final-answer message). */
  markSolved: z.boolean().optional(),
});

router.post(
  "/:id/fork",
  asyncHandler(async (req, res) => {
    const parsed = ForkBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Invalid body", parsed.error.issues);
    }
    const result = await forkConversation({
      sourceConversationId: pathParam(req, "id"),
      upToCreatedAt: new Date(parsed.data.upToCreatedAt),
      title: parsed.data.title,
      markSolved: parsed.data.markSolved,
    });
    res.status(201).json(result);
  }),
);

async function createConversationAndLedger(input: {
  userId: string;
  problemStatement: string;
  title?: string;
  reasoningSpeed?: "high" | "fast";
  additionalTools?: { cyAnalyst?: boolean; referenceSeeker?: boolean };
}) {
  const { collections } = await import("../db/mongo");
  const problemId = ids.problem();
  const conversationId = ids.conversation();
  const ledgerId = ids.ledger();
  const now = new Date();

  await collections.ledgers().insertOne({
    _id: ledgerId,
    problemId,
    conversationId,
    status: "active",
    problemStatement: input.problemStatement,
    createdAt: now,
    updatedAt: now,
  });
  await collections.conversations().insertOne({
    _id: conversationId,
    userId: input.userId,
    problemId,
    ledgerId,
    title: input.title ?? deriveTitle(input.problemStatement),
    status: "active",
    ...(input.reasoningSpeed ? { reasoningSpeed: input.reasoningSpeed } : {}),
    ...(input.additionalTools ? { additionalTools: input.additionalTools } : {}),
    createdAt: now,
    updatedAt: now,
  });

  return {
    conversation: await conversationRepo.requireById(conversationId),
    ledger: await ledgerRepo.requireById(ledgerId),
  };
}

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const conversation = await conversationRepo.requireById(pathParam(req, "id"));
    res.json({ conversation });
  }),
);

const PatchBody = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["active", "paused", "solved", "failed", "archived"]).optional(),
  reasoningSpeed: ReasoningSpeedSchema.optional(),
  additionalTools: AdditionalToolsSchema.optional(),
});

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Invalid body", parsed.error.issues);
    }
    const conversation = await conversationRepo.update(pathParam(req, "id"), parsed.data);
    if (parsed.data.status) {
      eventBus.emit({
        type: "conversation.status.changed",
        ledgerId: conversation.ledgerId,
        conversationId: conversation._id,
        status: conversation.status,
      });
    }
    res.json({ conversation });
  }),
);

router.get(
  "/:id/usage",
  asyncHandler(async (req, res) => {
    const id = pathParam(req, "id");
    const conversation = await conversationRepo.requireById(id);
    const breakdown = await usageRepo.breakdown(id);
    res.json({
      usage: conversation.usage ?? usageRepo.zero(),
      breakdown,
    });
  }),
);

router.post(
  "/:id/pause",
  asyncHandler(async (req, res) => {
    const id = pathParam(req, "id");
    await pauseSolverRun(id);
    const conversation = await conversationRepo.requireById(id);
    res.json({ conversation });
  }),
);

router.post(
  "/:id/resume",
  asyncHandler(async (req, res) => {
    const id = pathParam(req, "id");
    await resumeSolverRun(id);
    const conversation = await conversationRepo.requireById(id);
    res.status(202).json({ conversation });
  }),
);

router.post(
  "/:id/narrate",
  asyncHandler(async (req, res) => {
    const id = pathParam(req, "id");
    await startNarrativeGeneration(id);
    const conversation = await conversationRepo.requireById(id);
    res.status(202).json({ conversation });
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = pathParam(req, "id");
    const conversation = await conversationRepo.requireById(id);

    if (isRunInFlight(id)) {
      throw new ConflictError(
        "Cannot delete a conversation while a solver run is in flight",
      );
    }

    const [
      filesDeleted,
      entriesDeleted,
      messagesDeleted,
      sideTalkDeleted,
      usageDeleted,
    ] = await Promise.all([
      filesRepo.deleteByConversation(id),
      ledgerRepo.deleteEntriesByLedger(conversation.ledgerId),
      conversationRepo.deleteMessagesByConversation(id),
      sideTalkRepo.deleteByConversation(id),
      usageRepo.deleteByConversation(id),
    ]);
    await ledgerRepo.deleteById(conversation.ledgerId);
    await conversationRepo.deleteById(id);

    logger.info(
      {
        conversationId: id,
        ledgerId: conversation.ledgerId,
        filesDeleted,
        entriesDeleted,
        messagesDeleted,
        sideTalkDeleted,
        usageDeleted,
      },
      "Conversation deleted",
    );

    res.status(204).end();
  }),
);

function deriveTitle(problem: string): string {
  const cleaned = problem.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57).trimEnd()}…`;
}

export default router;
