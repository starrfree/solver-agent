import { collections } from "../db/mongo";
import {
  ConversationMessage,
  GeneratedFile,
  LedgerEntry,
} from "../db/types";
import { conversationRepo } from "../repositories/conversationRepo";
import { filesRepo } from "../repositories/filesRepo";
import { ledgerRepo } from "../repositories/ledgerRepo";
import { ids } from "../util/ids";
import { logger } from "../util/logger";

export interface ForkConversationInput {
  sourceConversationId: string;
  /**
   * Copy every ledger entry and conversation message created at or before
   * this instant — i.e. the timeline position the user forked from. The
   * forked-from item itself is included.
   */
  upToCreatedAt: Date;
  /** Optional title override for the new conversation. */
  title?: string;
  /**
   * When the fork branches from the assistant message that answers the
   * problem, the new conversation reproduces a completed solution: it starts
   * `solved` (carrying over the final answer and narrative) rather than the
   * default `paused` branch point.
   */
  markSolved?: boolean;
}

export interface ForkConversationResult {
  conversationId: string;
  ledgerId: string;
  problemId: string;
}

/**
 * Create a brand-new conversation that reproduces the content of an existing
 * one up to a given point in its timeline. Ledger entries, conversation
 * messages, and generated files are deep-copied with freshly minted IDs, and
 * every cross-reference (`dependsOn`, `relatedEntries`, artifact `fileId`s) is
 * remapped onto the new IDs so the fork is a fully independent branch.
 *
 * The fork normally starts `paused` (both conversation and ledger) so the user
 * lands on the branch point with the existing "Resume / send a follow-up"
 * affordance, rather than re-running the solver automatically. When the fork
 * branches from the final-answer assistant message (`markSolved`), it instead
 * starts `solved` and carries over the final answer + narrative. Side-talk is
 * intentionally not copied — it is off-the-record and never part of the solver
 * state.
 */
export async function forkConversation(
  input: ForkConversationInput,
): Promise<ForkConversationResult> {
  const source = await conversationRepo.requireById(input.sourceConversationId);
  const sourceLedger = await ledgerRepo.requireById(source.ledgerId);

  const cutoff = input.upToCreatedAt.getTime();
  const now = new Date();
  const status = input.markSolved ? "solved" : "paused";

  const problemId = ids.problem();
  const conversationId = ids.conversation();
  const ledgerId = ids.ledger();

  const sourceEntries = (await ledgerRepo.listEntries(sourceLedger._id)).filter(
    (e) => e.createdAt.getTime() <= cutoff,
  );
  const sourceMessages = (await conversationRepo.listMessages(source._id)).filter(
    (m) => m.createdAt.getTime() <= cutoff,
  );

  // Remap entry IDs old -> new so dependency / reference edges stay internal
  // to the fork. References pointing at entries beyond the cutoff are dropped.
  const entryIdMap = new Map<string, string>();
  for (const e of sourceEntries) entryIdMap.set(e._id, ids.entry());
  const remapEntryRefs = (refs: string[]): string[] =>
    refs
      .map((id) => entryIdMap.get(id))
      .filter((id): id is string => Boolean(id));

  await collections.ledgers().insertOne({
    _id: ledgerId,
    problemId,
    conversationId,
    status,
    problemStatement: sourceLedger.problemStatement,
    ...(sourceLedger.normalizedProblem
      ? { normalizedProblem: sourceLedger.normalizedProblem }
      : {}),
    ...(input.markSolved && sourceLedger.finalAnswer
      ? { finalAnswer: sourceLedger.finalAnswer }
      : {}),
    ...(input.markSolved && sourceLedger.narrative
      ? { narrative: sourceLedger.narrative }
      : {}),
    createdAt: now,
    updatedAt: now,
  });

  const newEntries: LedgerEntry[] = sourceEntries.map((e) => ({
    ...e,
    _id: entryIdMap.get(e._id)!,
    ledgerId,
    dependsOn: remapEntryRefs(e.dependsOn),
  }));
  if (newEntries.length > 0) {
    await collections.ledgerEntries().insertMany(newEntries);
  }

  // Duplicate the generated-file bytes referenced by the copied entries and
  // rewrite the artifact `fileId`s on the new entries to point at the copies.
  for (const e of sourceEntries) {
    const artifactFiles = e.artifacts?.files;
    if (!artifactFiles || artifactFiles.length === 0) continue;

    const newEntryId = entryIdMap.get(e._id)!;
    const sourceFiles = await filesRepo.findByEntry(e._id);
    if (sourceFiles.length === 0) continue;

    const fileIdMap = new Map<string, string>();
    const fileDocs: GeneratedFile[] = sourceFiles.map((f) => {
      const newFileId = ids.file();
      fileIdMap.set(f._id, newFileId);
      return {
        ...f,
        _id: newFileId,
        ledgerId,
        conversationId,
        entryId: newEntryId,
        createdAt: now,
      };
    });
    await collections.generatedFiles().insertMany(fileDocs);

    const remappedArtifactFiles = artifactFiles.map((af) =>
      af.fileId && fileIdMap.has(af.fileId)
        ? { ...af, fileId: fileIdMap.get(af.fileId)! }
        : af,
    );
    await collections
      .ledgerEntries()
      .updateOne(
        { _id: newEntryId },
        { $set: { "artifacts.files": remappedArtifactFiles } },
      );
  }

  const newMessages: ConversationMessage[] = sourceMessages.map((m) => ({
    ...m,
    _id: ids.message(),
    conversationId,
    relatedEntries: remapEntryRefs(m.relatedEntries),
  }));
  if (newMessages.length > 0) {
    await collections.conversationMessages().insertMany(newMessages);
  }

  await collections.conversations().insertOne({
    _id: conversationId,
    userId: source.userId,
    problemId,
    ledgerId,
    title: input.title?.trim() || deriveForkTitle(source.title),
    status,
    ...(source.reasoningSpeed ? { reasoningSpeed: source.reasoningSpeed } : {}),
    ...(source.additionalTools ? { additionalTools: source.additionalTools } : {}),
    createdAt: now,
    updatedAt: now,
  });

  logger.info(
    {
      sourceConversationId: source._id,
      conversationId,
      ledgerId,
      entriesCopied: newEntries.length,
      messagesCopied: newMessages.length,
    },
    "Conversation forked",
  );

  return { conversationId, ledgerId, problemId };
}

function deriveForkTitle(title: string): string {
  const base = title.startsWith("Fork of ") ? title : `Fork of ${title}`;
  if (base.length <= 80) return base;
  return `${base.slice(0, 77).trimEnd()}…`;
}
