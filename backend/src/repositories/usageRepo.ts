import { collections } from "../db/mongo";
import {
  ConversationUsage,
  UsageAgentRole,
  UsageRecord,
  UsageTokens,
} from "../db/types";
import { ids } from "../util/ids";

export interface RecordUsageInput {
  conversationId: string;
  ledgerId: string;
  provider: string;
  model: string;
  role: UsageAgentRole;
  tokens: UsageTokens;
  costUsd: number;
}

/** One breakdown row, grouped by agent role + model. */
export interface UsageBreakdownRow {
  role: UsageAgentRole;
  model: string;
  tokens: UsageTokens;
  costUsd: number;
  calls: number;
}

const ZERO_USAGE: ConversationUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  calls: 0,
};

export const usageRepo = {
  /**
   * Persist a single call's usage as an append-only record and fold it into
   * the conversation's running aggregate atomically. Returns the updated
   * aggregate so the caller can broadcast it.
   */
  async record(input: RecordUsageInput): Promise<ConversationUsage> {
    const record: UsageRecord = {
      _id: ids.usage(),
      conversationId: input.conversationId,
      ledgerId: input.ledgerId,
      provider: input.provider,
      model: input.model,
      role: input.role,
      tokens: input.tokens,
      costUsd: input.costUsd,
      createdAt: new Date(),
    };
    await collections.usageRecords().insertOne(record);

    const t = input.tokens;
    const updated = await collections.conversations().findOneAndUpdate(
      { _id: input.conversationId },
      {
        $inc: {
          "usage.inputTokens": t.inputTokens,
          "usage.cachedInputTokens": t.cachedInputTokens,
          "usage.outputTokens": t.outputTokens,
          "usage.reasoningTokens": t.reasoningTokens,
          "usage.totalTokens": t.totalTokens,
          "usage.costUsd": input.costUsd,
          "usage.calls": 1,
        },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: "after" },
    );
    return updated?.usage ?? { ...ZERO_USAGE };
  },

  /** Per-(role, model) usage breakdown for a conversation. */
  async breakdown(conversationId: string): Promise<UsageBreakdownRow[]> {
    const rows = await collections
      .usageRecords()
      .aggregate<{
        _id: { role: UsageAgentRole; model: string };
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        totalTokens: number;
        costUsd: number;
        calls: number;
      }>([
        { $match: { conversationId } },
        {
          $group: {
            _id: { role: "$role", model: "$model" },
            inputTokens: { $sum: "$tokens.inputTokens" },
            cachedInputTokens: { $sum: "$tokens.cachedInputTokens" },
            outputTokens: { $sum: "$tokens.outputTokens" },
            reasoningTokens: { $sum: "$tokens.reasoningTokens" },
            totalTokens: { $sum: "$tokens.totalTokens" },
            costUsd: { $sum: "$costUsd" },
            calls: { $sum: 1 },
          },
        },
        { $sort: { costUsd: -1 } },
      ])
      .toArray();

    return rows.map((r) => ({
      role: r._id.role,
      model: r._id.model,
      tokens: {
        inputTokens: r.inputTokens,
        cachedInputTokens: r.cachedInputTokens,
        outputTokens: r.outputTokens,
        reasoningTokens: r.reasoningTokens,
        totalTokens: r.totalTokens,
      },
      costUsd: r.costUsd,
      calls: r.calls,
    }));
  },

  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await collections
      .usageRecords()
      .deleteMany({ conversationId });
    return result.deletedCount ?? 0;
  },

  zero(): ConversationUsage {
    return { ...ZERO_USAGE };
  },
};
