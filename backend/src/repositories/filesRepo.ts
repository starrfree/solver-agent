import { Binary } from "mongodb";

import { collections } from "../db/mongo";
import { GeneratedFile } from "../db/types";
import { NotFoundError } from "../util/errors";
import { ids } from "../util/ids";

export interface CreateGeneratedFileInput {
  ledgerId: string;
  conversationId: string;
  entryId: string;
  name: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

/**
 * Mongo's driver returns BSON Binary on read; we want a plain Node Buffer
 * everywhere outside the repository.
 */
function toBuffer(value: Buffer | Binary | unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Binary) return Buffer.from(value.buffer);
  if (value && typeof value === "object" && "buffer" in (value as Binary)) {
    return Buffer.from((value as Binary).buffer);
  }
  return Buffer.alloc(0);
}

function normalize(file: GeneratedFile): GeneratedFile {
  return { ...file, data: toBuffer(file.data) };
}

export const filesRepo = {
  async create(input: CreateGeneratedFileInput): Promise<GeneratedFile> {
    const doc: GeneratedFile = {
      _id: ids.file(),
      ledgerId: input.ledgerId,
      conversationId: input.conversationId,
      entryId: input.entryId,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      data: input.data,
      createdAt: new Date(),
    };
    await collections.generatedFiles().insertOne(doc);
    return doc;
  },

  async findById(id: string): Promise<GeneratedFile | null> {
    const doc = await collections.generatedFiles().findOne({ _id: id });
    return doc ? normalize(doc) : null;
  },

  async requireById(id: string): Promise<GeneratedFile> {
    const doc = await this.findById(id);
    if (!doc) throw new NotFoundError(`GeneratedFile ${id} not found`);
    return doc;
  },

  async findByEntry(entryId: string): Promise<GeneratedFile[]> {
    const docs = await collections
      .generatedFiles()
      .find({ entryId })
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map(normalize);
  },

  async findByLedger(ledgerId: string): Promise<GeneratedFile[]> {
    const docs = await collections
      .generatedFiles()
      .find({ ledgerId })
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map(normalize);
  },

  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await collections
      .generatedFiles()
      .deleteMany({ conversationId });
    return result.deletedCount ?? 0;
  },
};
