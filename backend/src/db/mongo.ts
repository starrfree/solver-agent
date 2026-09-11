import { Collection, Db, MongoClient } from "mongodb";

import { env } from "../config/env";
import { logger } from "../util/logger";
import {
  Conversation,
  ConversationMessage,
  GeneratedFile,
  Ledger,
  LedgerEntry,
  SideTalkMessage,
  UsageRecord,
} from "./types";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(env.MONGODB_URI, {
    appName: "solver-agent-backend",
  });
  await client.connect();
  db = client.db(env.MONGODB_DB);

  await ensureIndexes(db);
  logger.info({ dbName: env.MONGODB_DB }, "MongoDB connected");
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("MongoDB not connected. Call connectMongo() first.");
  }
  return db;
}

export async function disconnectMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info("MongoDB disconnected");
  }
}

export const collections = {
  conversations: (): Collection<Conversation> =>
    getDb().collection<Conversation>("conversations"),
  conversationMessages: (): Collection<ConversationMessage> =>
    getDb().collection<ConversationMessage>("conversationMessages"),
  sideTalkMessages: (): Collection<SideTalkMessage> =>
    getDb().collection<SideTalkMessage>("sideTalkMessages"),
  ledgers: (): Collection<Ledger> => getDb().collection<Ledger>("ledgers"),
  ledgerEntries: (): Collection<LedgerEntry> =>
    getDb().collection<LedgerEntry>("ledgerEntries"),
  generatedFiles: (): Collection<GeneratedFile> =>
    getDb().collection<GeneratedFile>("generatedFiles"),
  usageRecords: (): Collection<UsageRecord> =>
    getDb().collection<UsageRecord>("usageRecords"),
};

async function ensureIndexes(database: Db): Promise<void> {
  await Promise.all([
    database
      .collection<Conversation>("conversations")
      .createIndex({ userId: 1, updatedAt: -1 }),
    database
      .collection<Conversation>("conversations")
      .createIndex({ ledgerId: 1 }, { unique: true }),
    database
      .collection<ConversationMessage>("conversationMessages")
      .createIndex({ conversationId: 1, createdAt: 1 }),
    database
      .collection<SideTalkMessage>("sideTalkMessages")
      .createIndex({ conversationId: 1, createdAt: 1 }),
    database
      .collection<Ledger>("ledgers")
      .createIndex({ conversationId: 1 }, { unique: true }),
    database
      .collection<LedgerEntry>("ledgerEntries")
      .createIndex({ ledgerId: 1, createdAt: 1 }),
    database
      .collection<LedgerEntry>("ledgerEntries")
      .createIndex({ ledgerId: 1, type: 1 }),
    database
      .collection<GeneratedFile>("generatedFiles")
      .createIndex({ ledgerId: 1, createdAt: 1 }),
    database
      .collection<GeneratedFile>("generatedFiles")
      .createIndex({ conversationId: 1 }),
    database
      .collection<GeneratedFile>("generatedFiles")
      .createIndex({ entryId: 1 }),
    database
      .collection<UsageRecord>("usageRecords")
      .createIndex({ conversationId: 1, createdAt: 1 }),
    database
      .collection<UsageRecord>("usageRecords")
      .createIndex({ conversationId: 1, role: 1, model: 1 }),
  ]);
}
