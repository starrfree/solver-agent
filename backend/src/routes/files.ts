import { Router } from "express";

import { conversationRepo } from "../repositories/conversationRepo";
import { filesRepo } from "../repositories/filesRepo";
import { asyncHandler, pathParam } from "../util/asyncHandler";
import { NotFoundError } from "../util/errors";

const router = Router({ mergeParams: true });

/**
 * Stream a generated file. The route is mounted under
 * `/api/conversations/:id/files`, so the conversation id is taken from the
 * parent router's params and verified against `file.conversationId` to
 * stop one conversation from peeking at another's artifacts.
 */
router.get(
  "/:fileId",
  asyncHandler(async (req, res) => {
    const conversationId = pathParam(req, "id");
    const fileId = pathParam(req, "fileId");

    await conversationRepo.requireById(conversationId);
    const file = await filesRepo.findById(fileId);
    if (!file || file.conversationId !== conversationId) {
      throw new NotFoundError(`File ${fileId} not found`);
    }

    const safeName = file.name.replace(/"/g, "");
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(file.size));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${safeName}"`,
    );
    res.status(200).end(file.data);
  }),
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const conversationId = pathParam(req, "id");
    const conversation = await conversationRepo.requireById(conversationId);
    const files = await filesRepo.findByLedger(conversation.ledgerId);
    res.json({
      files: files.map((f) => ({
        _id: f._id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        entryId: f.entryId,
        createdAt: f.createdAt,
        url: `/api/conversations/${conversationId}/files/${f._id}`,
      })),
    });
  }),
);

export default router;
