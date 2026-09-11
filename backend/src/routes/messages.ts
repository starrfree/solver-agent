import { Router } from "express";
import { z } from "zod";

import { DEFAULT_REASONING_SPEED } from "../db/types";
import { eventBus } from "../events/eventBus";
import { conversationRepo } from "../repositories/conversationRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import {
  isRunInFlight,
  pauseSolverRun,
  startSolverRun,
} from "../services/solverOrchestrator";
import { asyncHandler, pathParam } from "../util/asyncHandler";
import { BadRequestError, ConflictError } from "../util/errors";

const FOLLOWUP_SUMMARY_MAX = 80;

function summarizeFollowup(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (cleaned.length <= FOLLOWUP_SUMMARY_MAX) return `User follow-up: ${cleaned}`;
  return `User follow-up: ${cleaned.slice(0, FOLLOWUP_SUMMARY_MAX - 1).trimEnd()}…`;
}

const router = Router({ mergeParams: true });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const id = pathParam(req, "id");
    await conversationRepo.requireById(id);
    const messages = await conversationRepo.listMessages(id);
    res.json({ messages });
  }),
);

const PostBody = z.object({
  content: z.string().min(1),
  reasoningSpeed: z.enum(["high", "fast"]).optional(),
  additionalTools: z
    .object({
      cyAnalyst: z.boolean().optional(),
      referenceSeeker: z.boolean().optional(),
    })
    .optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Invalid body", parsed.error.issues);
    }
    const conversation = await conversationRepo.requireById(pathParam(req, "id"));
    if (conversation.status === "archived") {
      throw new ConflictError("Cannot post to an archived conversation");
    }
    // If a solver run is currently in flight, pause it first so the
    // follow-up message lands cleanly in the ledger; the run is then
    // resumed below with the new message included in the input.
    if (isRunInFlight(conversation._id)) {
      await pauseSolverRun(conversation._id);
    }
    if (
      parsed.data.reasoningSpeed &&
      parsed.data.reasoningSpeed !== conversation.reasoningSpeed
    ) {
      await conversationRepo.update(conversation._id, {
        reasoningSpeed: parsed.data.reasoningSpeed,
      });
      conversation.reasoningSpeed = parsed.data.reasoningSpeed;
    }
    if (
      parsed.data.additionalTools &&
      ((parsed.data.additionalTools.cyAnalyst ?? false) !==
        (conversation.additionalTools?.cyAnalyst ?? false) ||
        (parsed.data.additionalTools.referenceSeeker ?? false) !==
          (conversation.additionalTools?.referenceSeeker ?? false))
    ) {
      await conversationRepo.update(conversation._id, {
        additionalTools: parsed.data.additionalTools,
      });
      conversation.additionalTools = parsed.data.additionalTools;
    }
    const followupEntry = await ledgerRepo.appendEntry({
      ledgerId: conversation.ledgerId,
      type: "problem_followup",
      status: "accepted",
      dependsOn: [],
      content: {
        summary: summarizeFollowup(parsed.data.content),
        details: { body: parsed.data.content },
      },
      tool: "user",
      reasoningSpeed: conversation.reasoningSpeed ?? DEFAULT_REASONING_SPEED,
    });

    const message = await conversationRepo.appendMessage({
      conversationId: conversation._id,
      role: "user",
      content: parsed.data.content,
      relatedEntries: [followupEntry._id],
    });
    eventBus.emit({
      type: "conversation.message.added",
      ledgerId: conversation.ledgerId,
      conversationId: conversation._id,
      message,
    });
    eventBus.emit({
      type: "ledger.entry.added",
      ledgerId: conversation.ledgerId,
      conversationId: conversation._id,
      entry: followupEntry,
    });

    // Re-activate based on the CURRENT persisted status, not the stale
    // in-memory `conversation` snapshot taken before this handler ran:
    // pauseSolverRun above may have already flipped the conversation to
    // 'paused', and the snapshot would otherwise make us skip re-activation —
    // leaving the conversation 'paused' while the run we start below executes.
    const current = await conversationRepo.findById(conversation._id);
    if (current && current.status !== "active") {
      await conversationRepo.setStatus(conversation._id, "active");
      eventBus.emit({
        type: "conversation.status.changed",
        ledgerId: conversation.ledgerId,
        conversationId: conversation._id,
        status: "active",
      });
    }
    const ledger = await ledgerRepo.findById(conversation.ledgerId);
    if (ledger && ledger.status === "paused") {
      const updated = await ledgerRepo.setStatus(ledger._id, "active");
      eventBus.emit({
        type: "ledger.status.changed",
        ledgerId: updated._id,
        conversationId: conversation._id,
        status: updated.status,
      });
    }

    void startSolverRun(conversation._id);
    res.status(202).json({ message });
  }),
);

export default router;
