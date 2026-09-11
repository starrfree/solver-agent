import { Router } from "express";

import { buildExport } from "../export/buildExport";
import { createExportArchive } from "../export/zipBundle";
import { asyncHandler, pathParam } from "../util/asyncHandler";
import { logger } from "../util/logger";

const router = Router({ mergeParams: true });

/**
 * `GET /api/conversations/:id/export`
 *
 * Streams a zip bundle with a verbatim, shareable record of the conversation
 * (see `createExportArchive` for the layout). No LLM is involved; the documents
 * are rendered deterministically from the database, so exporting is free and
 * reproducible.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const conversationId = pathParam(req, "id");
    const bundle = await buildExport(conversationId);

    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${bundle.fileName}"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = createExportArchive(bundle);
    archive.on("warning", (err) => {
      logger.warn({ err, conversationId }, "Export archive warning");
    });
    archive.on("error", (err) => {
      logger.error({ err, conversationId }, "Export archive failed");
      res.destroy(err);
    });
    archive.pipe(res);
  }),
);

export default router;
