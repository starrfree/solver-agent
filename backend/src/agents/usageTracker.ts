/**
 * Records token usage for a completed LLM response. Invoked from the single
 * `llmClient.createResponse` choke point so every call — main solver,
 * sub-agents, narrator, side-talk — is captured uniformly. Attribution comes
 * from the ambient {@link getUsageContext}; calls made outside an active
 * context (none currently expected) are silently skipped.
 */
import type { Response } from "openai/resources/responses/responses";

import { computeCostUsd } from "../config/pricing";
import type { UsageAgentRole, UsageTokens } from "../db/types";
import { eventBus } from "../events/eventBus";
import { usageRepo } from "../repositories/usageRepo";
import { logger } from "../util/logger";
import { getUsageContext } from "./usageContext";

export async function recordResponseUsage(args: {
  response: Response;
  provider: string;
  model: string;
  role: UsageAgentRole;
}): Promise<void> {
  // Capture synchronously: AsyncLocalStorage is active when this runs (right
  // after the awaited response resolves), so reading it before any further
  // await keeps attribution correct even if the DB write settles later.
  const ctx = getUsageContext();
  if (!ctx) return;

  const usage = args.response.usage;
  if (!usage) return;

  const inputTokens = usage.input_tokens ?? 0;
  const cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;

  const tokens: UsageTokens = {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };

  const costUsd = computeCostUsd(args.model, usage);

  const aggregate = await usageRepo.record({
    conversationId: ctx.conversationId,
    ledgerId: ctx.ledgerId,
    provider: args.provider,
    model: args.model,
    role: args.role,
    tokens,
    costUsd,
  });

  eventBus.emit({
    type: "usage.updated",
    conversationId: ctx.conversationId,
    ledgerId: ctx.ledgerId,
    usage: aggregate,
  });
}

/** Fire-and-forget wrapper: usage telemetry must never break a solve. */
export function recordResponseUsageSafe(args: {
  response: Response;
  provider: string;
  model: string;
  role: UsageAgentRole;
}): void {
  void recordResponseUsage(args).catch((err) => {
    logger.warn({ err, model: args.model }, "Failed to record LLM usage");
  });
}
