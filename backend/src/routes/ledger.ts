import { Router } from "express";
import { z } from "zod";

import { conversationRepo } from "../repositories/conversationRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { asyncHandler, pathParam } from "../util/asyncHandler";
import { BadRequestError, NotFoundError } from "../util/errors";

const router = Router({ mergeParams: true });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const conversation = await conversationRepo.requireById(pathParam(req, "id"));
    const ledger = await ledgerRepo.findById(conversation.ledgerId);
    if (!ledger) throw new NotFoundError(`Ledger ${conversation.ledgerId} not found`);
    res.json({ ledger });
  }),
);

const EntriesQuery = z.object({
  since: z.string().datetime().optional(),
});

router.get(
  "/entries",
  asyncHandler(async (req, res) => {
    const parsed = EntriesQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new BadRequestError("Invalid query", parsed.error.issues);
    }
    const conversation = await conversationRepo.requireById(pathParam(req, "id"));
    const since = parsed.data.since ? new Date(parsed.data.since) : undefined;
    const entries = await ledgerRepo.listEntries(conversation.ledgerId, since);
    res.json({ entries });
  }),
);

export default router;
