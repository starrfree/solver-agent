import { Router } from "express";
import { z } from "zod";

import { runSideTalk } from "../agents/sideTalkAgent";
import { runWithUsageContext } from "../agents/usageContext";
import { conversationRepo } from "../repositories/conversationRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { sideTalkRepo } from "../repositories/sideTalkRepo";
import { asyncHandler, pathParam } from "../util/asyncHandler";
import { BadRequestError, NotFoundError } from "../util/errors";

const router = Router({ mergeParams: true });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const id = pathParam(req, "id");
    await conversationRepo.requireById(id);
    const messages = await sideTalkRepo.list(id);
    res.json({ messages });
  }),
);

const PostBody = z.object({
  content: z.string().min(1),
  webSearch: z.boolean().optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError("Invalid body", parsed.error.issues);
    }
    const conversation = await conversationRepo.requireById(pathParam(req, "id"));
    const ledger = await ledgerRepo.requireById(conversation.ledgerId);

    const userMessage = await sideTalkRepo.append({
      conversationId: conversation._id,
      role: "user",
      content: parsed.data.content,
    });

    const [entries, messages, history] = await Promise.all([
      ledgerRepo.listEntries(ledger._id),
      conversationRepo.listMessages(conversation._id),
      sideTalkRepo.list(conversation._id),
    ]);

    // `history` includes the user message we just appended; drop it so the
    // question is presented exactly once as the final turn.
    const priorHistory = history.filter((m) => m._id !== userMessage._id);

    const result = await runWithUsageContext(
      { conversationId: conversation._id, ledgerId: ledger._id },
      () =>
        runSideTalk({
          conversation,
          ledger,
          entries,
          history: priorHistory,
          messages,
          question: parsed.data.content,
          webSearch: parsed.data.webSearch ?? false,
        }),
    );

    const assistantMessage = await sideTalkRepo.append({
      conversationId: conversation._id,
      role: "assistant",
      content: result.text || "I couldn't come up with a response to that.",
      loadedEntries: result.loadedEntries,
      loadedArtifacts: result.loadedArtifacts,
    });

    res.json({ userMessage, assistantMessage });
  }),
);

router.delete(
  "/",
  asyncHandler(async (req, res) => {
    const id = pathParam(req, "id");
    await conversationRepo.requireById(id);
    await sideTalkRepo.deleteByConversation(id);
    res.status(204).end();
  }),
);

router.delete(
  "/:messageId",
  asyncHandler(async (req, res) => {
    await conversationRepo.requireById(pathParam(req, "id"));
    const deleted = await sideTalkRepo.deleteById(pathParam(req, "messageId"));
    if (!deleted) {
      throw new NotFoundError("Side-talk message not found");
    }
    res.status(204).end();
  }),
);

export default router;
