import { filesRepo } from "../repositories/filesRepo";
import { logger } from "../util/logger";
import { ToolContext, ToolHandler } from "./types";

interface FetchArtifactFileArgs {
  fileId: string;
  purpose: string;
}

/**
 * Bytes returned in `function_call_output` are not free; cap them so a
 * single fetch cannot blow up the context window. Larger files are still
 * served by the HTTP endpoint and remain referenceable through their URL.
 */
const MAX_INLINE_BASE64_BYTES = 256 * 1024;

export const fetchArtifactFileHandler: ToolHandler = async (
  ctx: ToolContext,
  call,
) => {
  let args: FetchArtifactFileArgs;
  try {
    args = JSON.parse(call.arguments) as FetchArtifactFileArgs;
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: `Invalid JSON: ${(err as Error).message}`,
    });
  }
  if (!args.fileId) {
    return JSON.stringify({ ok: false, error: "Field 'fileId' is required." });
  }

  try {
    const file = await filesRepo.findById(args.fileId);
    if (!file || file.ledgerId !== ctx.ledger._id) {
      return JSON.stringify({
        ok: false,
        error: `File ${args.fileId} not found in this conversation.`,
      });
    }

    const url = `/api/conversations/${ctx.conversation._id}/files/${file._id}`;
    const isImage = file.mimeType.startsWith("image/");
    const dataUrl = `data:${file.mimeType};base64,${file.data.toString("base64")}`;

    if (isImage) {
      ctx.extraInputItems.push({
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Inline content of fetched file ${file._id} (${file.name}, ${file.mimeType}, ${file.size} bytes).`,
          },
          {
            type: "input_image",
            image_url: dataUrl,
            detail: "auto",
          },
        ],
      });

      return JSON.stringify({
        ok: true,
        fileId: file._id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        url,
        contentDelivered: "input_image",
        note: "Image bytes appended as an input_image content part in the next user message.",
      });
    }

    if (file.size > MAX_INLINE_BASE64_BYTES) {
      return JSON.stringify({
        ok: true,
        fileId: file._id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        url,
        contentDelivered: "url_only",
        reason: `File is ${file.size} bytes; exceeds inline limit of ${MAX_INLINE_BASE64_BYTES}. Reference it by URL instead.`,
      });
    }

    return JSON.stringify({
      ok: true,
      fileId: file._id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      url,
      contentDelivered: "base64",
      base64: file.data.toString("base64"),
    });
  } catch (err) {
    logger.error({ err, fileId: args.fileId }, "fetch_artifact_file failed");
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
