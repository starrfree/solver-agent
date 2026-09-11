import { collections } from "../db/mongo";
import {
  SideTalkArtifactRef,
  SideTalkEntryRef,
  SideTalkMessage,
} from "../db/types";
import { ids } from "../util/ids";

export interface AppendSideTalkInput {
  conversationId: string;
  role: SideTalkMessage["role"];
  content: string;
  loadedEntries?: SideTalkEntryRef[];
  loadedArtifacts?: SideTalkArtifactRef[];
}

/**
 * Persistence for "side-talk" — an off-the-record Q&A channel about the
 * ongoing work. Kept in its own collection so it never leaks into the
 * solver's input or the ledger.
 */
export const sideTalkRepo = {
  async append(input: AppendSideTalkInput): Promise<SideTalkMessage> {
    const message: SideTalkMessage = {
      _id: ids.sideTalkMessage(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      ...(input.loadedEntries && input.loadedEntries.length > 0
        ? { loadedEntries: input.loadedEntries }
        : {}),
      ...(input.loadedArtifacts && input.loadedArtifacts.length > 0
        ? { loadedArtifacts: input.loadedArtifacts }
        : {}),
      createdAt: new Date(),
    };
    await collections.sideTalkMessages().insertOne(message);
    return message;
  },

  async list(conversationId: string): Promise<SideTalkMessage[]> {
    return collections
      .sideTalkMessages()
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .toArray();
  },

  async deleteById(id: string): Promise<boolean> {
    const result = await collections.sideTalkMessages().deleteOne({ _id: id });
    return result.deletedCount > 0;
  },

  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await collections
      .sideTalkMessages()
      .deleteMany({ conversationId });
    return result.deletedCount ?? 0;
  },
};
