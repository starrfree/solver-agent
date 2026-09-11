/**
 * Ambient attribution context for LLM usage tracking.
 *
 * Every LLM call funnels through `llmClient.createResponse`, which does not
 * otherwise know which conversation/ledger it belongs to. Rather than thread
 * those ids through every agent and sub-agent signature, we stash them in an
 * `AsyncLocalStorage` set once at the top of a solver run (and the side-talk
 * handler). All nested, awaited sub-agent calls inherit the same store
 * automatically, so `createResponse` can attribute usage without any plumbing.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface UsageContext {
  conversationId: string;
  ledgerId: string;
}

const storage = new AsyncLocalStorage<UsageContext>();

/** Run `fn` with the given usage context active for the whole async subtree. */
export function runWithUsageContext<T>(
  ctx: UsageContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

/** Read the current usage context, or `undefined` when none is active. */
export function getUsageContext(): UsageContext | undefined {
  return storage.getStore();
}
