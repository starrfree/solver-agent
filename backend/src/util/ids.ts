import { v4 as uuidv4 } from "uuid";

export function newId(prefix?: string, length?: number): string {
  let id = uuidv4();
  if (length && length > 0) {
    id = id.replace(/-/g, "").slice(0, length);
  }
  return prefix ? `${prefix}_${id}` : id;
}

export const ids = {
  conversation: () => newId("conv"),
  message: () => newId("msg"),
  sideTalkMessage: () => newId("side"),
  ledger: () => newId("ledg"),
  entry: () => newId("entry", 8),
  problem: () => newId("prob"),
  file: () => newId("file"),
  usage: () => newId("use"),
};
