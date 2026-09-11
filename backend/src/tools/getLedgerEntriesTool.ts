import { LedgerEntry } from "../db/types";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { logger } from "../util/logger";
import { ToolContext, ToolHandler } from "./types";

interface GetLedgerEntriesArgs {
  entryIds: string[];
  purpose: string;
}

const MAX_CODE_CHARS = 4000;
const MAX_STDOUT_CHARS = 2000;
const MAX_STDERR_CHARS = 2000;

/**
 * Read-only retrieval of complete ledger entries by id. Unlike the compacted
 * snapshot in the side-talk context block, this returns the full, untruncated
 * entry: all content fields, the dependency graph, and any attached
 * computation artifacts (code, stdout/stderr, generated file references).
 *
 * It never mutates anything. File *bytes* are not inlined here — the returned
 * `artifacts.files[].fileId` values can be passed to `fetch_artifact_file` to
 * actually load a plot or CSV into context.
 */
export const getLedgerEntriesHandler: ToolHandler = async (
  ctx: ToolContext,
  call,
) => {
  let args: GetLedgerEntriesArgs;
  try {
    args = JSON.parse(call.arguments) as GetLedgerEntriesArgs;
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: `Invalid JSON: ${(err as Error).message}`,
    });
  }

  if (!Array.isArray(args.entryIds) || args.entryIds.length === 0) {
    return JSON.stringify({
      ok: false,
      error: "Field 'entryIds' must be a non-empty array of ledger entry ids.",
    });
  }

  try {
    const found = await ledgerRepo.findEntries(ctx.ledger._id, args.entryIds);
    const byId = new Map(found.map((e) => [e._id, e]));
    // Preserve the caller's requested order; collect any ids we couldn't find.
    const entries = args.entryIds
      .map((id) => byId.get(id))
      .filter((e): e is LedgerEntry => Boolean(e))
      .map((e) => formatEntry(e, ctx.conversation._id));
    const missing = args.entryIds.filter((id) => !byId.has(id));

    return JSON.stringify({
      ok: true,
      entries,
      ...(missing.length > 0 ? { missing } : {}),
    });
  } catch (err) {
    logger.error(
      { err, entryIds: args.entryIds },
      "get_ledger_entries failed",
    );
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

function formatEntry(entry: LedgerEntry, conversationId: string) {
  const artifacts = entry.artifacts
    ? {
        ...(entry.artifacts.code
          ? { code: truncate(entry.artifacts.code, MAX_CODE_CHARS) }
          : {}),
        ...(entry.artifacts.stdout
          ? { stdout: truncate(entry.artifacts.stdout, MAX_STDOUT_CHARS) }
          : {}),
        ...(entry.artifacts.stderr
          ? { stderr: truncate(entry.artifacts.stderr, MAX_STDERR_CHARS) }
          : {}),
        ...(typeof entry.artifacts.durationMs === "number"
          ? { durationMs: entry.artifacts.durationMs }
          : {}),
        ...(entry.artifacts.files && entry.artifacts.files.length > 0
          ? {
              files: entry.artifacts.files.map((f) => ({
                ...(f.fileId ? { fileId: f.fileId } : {}),
                name: f.name,
                mimeType: f.mimeType,
                size: f.size,
                ...(f.skipped ? { skipped: f.skipped } : {}),
                ...(f.reason ? { reason: f.reason } : {}),
                ...(f.fileId
                  ? {
                      url: `/api/conversations/${conversationId}/files/${f.fileId}`,
                    }
                  : {}),
              })),
            }
          : {}),
      }
    : undefined;

  return {
    id: entry._id,
    type: entry.type,
    status: entry.status,
    tool: entry.tool,
    dependsOn: entry.dependsOn,
    content: entry.content,
    ...(artifacts && Object.keys(artifacts).length > 0 ? { artifacts } : {}),
    createdAt: entry.createdAt,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [truncated]`;
}
