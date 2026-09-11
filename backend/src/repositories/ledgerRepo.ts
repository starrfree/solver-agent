import { collections } from "../db/mongo";
import {
  Ledger,
  LedgerEntry,
  LedgerEntryArtifact,
  LedgerEntryArtifacts,
  LedgerEntryContent,
  LedgerEntryStatus,
  LedgerEntryTool,
  LedgerEntryType,
  LedgerStatus,
  ReasoningSpeed,
} from "../db/types";
import { NotFoundError } from "../util/errors";
import { ids } from "../util/ids";

export interface CreateLedgerInput {
  problemId: string;
  conversationId: string;
  problemStatement: string;
}

export interface AppendEntryInput {
  ledgerId: string;
  type: LedgerEntryType;
  status?: LedgerEntryStatus;
  dependsOn?: string[];
  content: LedgerEntryContent;
  tool: LedgerEntryTool;
  artifacts?: LedgerEntryArtifacts;
  reasoningSpeed?: ReasoningSpeed;
}

export const ledgerRepo = {
  async create(input: CreateLedgerInput): Promise<Ledger> {
    const now = new Date();
    const doc: Ledger = {
      _id: ids.ledger(),
      problemId: input.problemId,
      conversationId: input.conversationId,
      status: "active",
      problemStatement: input.problemStatement,
      createdAt: now,
      updatedAt: now,
    };
    await collections.ledgers().insertOne(doc);
    return doc;
  },

  async findById(id: string): Promise<Ledger | null> {
    return collections.ledgers().findOne({ _id: id });
  },

  async findByConversationId(conversationId: string): Promise<Ledger | null> {
    return collections.ledgers().findOne({ conversationId });
  },

  async requireById(id: string): Promise<Ledger> {
    const l = await this.findById(id);
    if (!l) throw new NotFoundError(`Ledger ${id} not found`);
    return l;
  },

  async setStatus(id: string, status: LedgerStatus): Promise<Ledger> {
    const result = await collections.ledgers().findOneAndUpdate(
      { _id: id },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) throw new NotFoundError(`Ledger ${id} not found`);
    return result;
  },

  async setNormalizedProblem(id: string, normalizedProblem: string): Promise<void> {
    await collections.ledgers().updateOne(
      { _id: id },
      {
        $set: { normalizedProblem, updatedAt: new Date() },
      },
    );
  },

  async setFinalAnswer(id: string, finalAnswer: string): Promise<Ledger> {
    const result = await collections.ledgers().findOneAndUpdate(
      { _id: id },
      { $set: { finalAnswer, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) throw new NotFoundError(`Ledger ${id} not found`);
    return result;
  },

  async setNarrative(id: string, narrative: string): Promise<Ledger> {
    const result = await collections.ledgers().findOneAndUpdate(
      { _id: id },
      { $set: { narrative, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) throw new NotFoundError(`Ledger ${id} not found`);
    return result;
  },

  async appendEntry(input: AppendEntryInput): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      _id: ids.entry(),
      ledgerId: input.ledgerId,
      type: input.type,
      status: input.status ?? "accepted",
      dependsOn: input.dependsOn ?? [],
      content: input.content,
      tool: input.tool,
      ...(input.artifacts ? { artifacts: input.artifacts } : {}),
      ...(input.reasoningSpeed ? { reasoningSpeed: input.reasoningSpeed } : {}),
      createdAt: new Date(),
    };
    await collections.ledgerEntries().insertOne(entry);
    await collections
      .ledgers()
      .updateOne({ _id: input.ledgerId }, { $set: { updatedAt: new Date() } });
    return entry;
  },

  /**
   * Flip the status of an existing entry. The only allowed in-place mutation
   * is marking an entry `superseded` (or `rejected`) when a
   * correction supplants it. The original content is preserved.
   */
  async setEntryStatus(
    entryId: string,
    status: LedgerEntryStatus,
  ): Promise<LedgerEntry> {
    const result = await collections.ledgerEntries().findOneAndUpdate(
      { _id: entryId },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!result) throw new NotFoundError(`LedgerEntry ${entryId} not found`);
    return result;
  },

  /**
   * Patch the `artifacts.files` array on an existing entry. Used after
   * the computation tool persists generated files to the dedicated
   * collection and replaces the empty placeholder list with file refs.
   */
  async setEntryArtifactFiles(
    entryId: string,
    files: LedgerEntryArtifact[],
  ): Promise<LedgerEntry> {
    const result = await collections.ledgerEntries().findOneAndUpdate(
      { _id: entryId },
      {
        $set: {
          "artifacts.files": files,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!result) throw new NotFoundError(`LedgerEntry ${entryId} not found`);
    return result;
  },

  async findEntry(entryId: string): Promise<LedgerEntry | null> {
    return collections.ledgerEntries().findOne({ _id: entryId });
  },

  async listEntries(ledgerId: string, since?: Date): Promise<LedgerEntry[]> {
    const filter: Record<string, unknown> = { ledgerId };
    if (since) filter.createdAt = { $gt: since };
    return collections
      .ledgerEntries()
      .find(filter)
      .sort({ createdAt: 1 })
      .toArray();
  },

  async findEntries(
    ledgerId: string,
    entryIds: string[],
  ): Promise<LedgerEntry[]> {
    if (entryIds.length === 0) return [];
    return collections
      .ledgerEntries()
      .find({ ledgerId, _id: { $in: entryIds } })
      .toArray();
  },

  async deleteById(id: string): Promise<boolean> {
    const result = await collections.ledgers().deleteOne({ _id: id });
    return result.deletedCount > 0;
  },

  async deleteEntriesByLedger(ledgerId: string): Promise<number> {
    const result = await collections.ledgerEntries().deleteMany({ ledgerId });
    return result.deletedCount ?? 0;
  },
};
