import { collections } from "../db/mongo";
import {
  Conversation,
  ConversationMessage,
  ConversationRole,
  ConversationStatus,
} from "../db/types";
import { NotFoundError } from "../util/errors";
import { ids } from "../util/ids";

export interface CreateConversationInput {
  userId: string;
  problemId: string;
  ledgerId: string;
  title: string;
}

export interface AppendMessageInput {
  conversationId: string;
  role: ConversationRole;
  content: string;
  relatedEntries?: string[];
}

export const conversationRepo = {
  async create(input: CreateConversationInput): Promise<Conversation> {
    const now = new Date();
    const doc: Conversation = {
      _id: ids.conversation(),
      userId: input.userId,
      problemId: input.problemId,
      ledgerId: input.ledgerId,
      title: input.title,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await collections.conversations().insertOne(doc);
    return doc;
  },

  async findById(id: string): Promise<Conversation | null> {
    return collections.conversations().findOne({ _id: id });
  },

  async findByLedgerId(ledgerId: string): Promise<Conversation | null> {
    return collections.conversations().findOne({ ledgerId });
  },

  async requireById(id: string): Promise<Conversation> {
    const c = await this.findById(id);
    if (!c) throw new NotFoundError(`Conversation ${id} not found`);
    return c;
  },

  async listByUser(userId: string, limit = 100): Promise<Conversation[]> {
    return collections
      .conversations()
      .find({ userId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray();
  },

  async update(
    id: string,
    patch: Partial<
      Pick<Conversation, "title" | "status" | "reasoningSpeed" | "additionalTools">
    >,
  ): Promise<Conversation> {
    const result = await collections.conversations().findOneAndUpdate(
      { _id: id },
      {
        $set: {
          ...patch,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!result) throw new NotFoundError(`Conversation ${id} not found`);
    return result;
  },

  async setStatus(id: string, status: ConversationStatus): Promise<void> {
    await collections.conversations().updateOne(
      { _id: id },
      {
        $set: { status, updatedAt: new Date() },
      },
    );
  },

  async touch(id: string): Promise<void> {
    await collections
      .conversations()
      .updateOne({ _id: id }, { $set: { updatedAt: new Date() } });
  },

  async appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
    const message: ConversationMessage = {
      _id: ids.message(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      relatedEntries: input.relatedEntries ?? [],
      createdAt: new Date(),
    };
    await collections.conversationMessages().insertOne(message);
    await this.touch(input.conversationId);
    return message;
  },

  async listMessages(conversationId: string): Promise<ConversationMessage[]> {
    return collections
      .conversationMessages()
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .toArray();
  },

  async deleteById(id: string): Promise<boolean> {
    const result = await collections.conversations().deleteOne({ _id: id });
    return result.deletedCount > 0;
  },

  async deleteMessagesByConversation(conversationId: string): Promise<number> {
    const result = await collections
      .conversationMessages()
      .deleteMany({ conversationId });
    return result.deletedCount ?? 0;
  },
};
