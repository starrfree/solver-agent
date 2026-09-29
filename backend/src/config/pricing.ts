/**
 * Model pricing table for token cost tracking. Rates are expressed in USD per
 * 1,000,000 tokens and follow OpenAI's three-column structure (uncached input,
 * cached input, output). Output tokens already include reasoning tokens, so
 * reasoning is billed once at the output rate.
 *
 * The defaults below reflect public list pricing (August 2026); they can be
 * overridden or extended at runtime via the `MODEL_PRICING_JSON` env var so a
 * rate change does not require a code edit.
 */
import { env } from "./env";
import { logger } from "../util/logger";

export interface ModelPricing {
  /** USD per 1M uncached input tokens. */
  input: number;
  /** USD per 1M cached input tokens. */
  cachedInput: number;
  /** USD per 1M output tokens (reasoning tokens included). */
  output: number;
}

/** Minimal structural view of an OpenAI-style `response.usage` object. */
export interface UsageLike {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number } | null;
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number } | null;
  total_tokens?: number;
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // GPT-6 Sol (developers.openai.com, Sep 2026), prompts <= 272K input tokens;
  // above that the full request bills 2x input/cache and 1.5x output (not modeled).
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.6-luna": { input: 1, cachedInput: 0.1, output: 6 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  // Anthropic list pricing (platform.claude.com, Aug 2026). Cache reads bill
  // at 10% of input; the 1.25x/2x cache-write premiums are not modeled here.
  "claude-fable-5": { input: 10, cachedInput: 1, output: 50 },
  "claude-opus-5-5": { input: 4, cachedInput: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cachedInput: 0.2, output: 10 },
  "claude-opus-5": { input: 5, cachedInput: 0.5, output: 25 },
  "claude-sonnet-5": { input: 2, cachedInput: 0.2, output: 10 },
  "claude-sonnet-4-6": { input: 3, cachedInput: 0.3, output: 15 },
  // HuggingFace router -> Together serverless list pricing (together.ai/pricing,
  // Aug 2026). Adjust via MODEL_PRICING_JSON when list pricing changes.
  "deepseek-ai/DeepSeek-V4-Pro-0813:together": { input: 1.32, cachedInput: 0.13, output: 3.96 },
  "deepseek-ai/DeepSeek-V4-Flash-0731:together": { input: 0.14, cachedInput: 0.03, output: 0.28 },
  // V4 Pro preview endpoint (superseded by the 0813 release above).
  "deepseek-ai/DeepSeek-V4-Pro:together": { input: 1.74, cachedInput: 0.2, output: 3.48 },
  "zai-org/GLM-5.2:together": { input: 1.4, cachedInput: 0.26, output: 4.4 },
  // Google Gemini Developer API paid-tier list pricing (ai.google.dev, Sep
  // 2026), text tokens, prompts <= 200k (Pro bills 2x/1.5x above 200k, not
  // modeled). Output already includes thinking tokens. The 3.6-3.8 Flash rates
  // are promotional through 2026-12-31 and double on 2027-01-01 — override via
  // MODEL_PRICING_JSON when they change.
  "gemini-3.1-pro-preview": { input: 2, cachedInput: 0.2, output: 12 },
  "gemini-3.8-flash": { input: 0.75, cachedInput: 0.075, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, cachedInput: 0.075, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, cachedInput: 0.075, output: 3.75 },
  "gemini-3.5-flash": { input: 1.5, cachedInput: 0.15, output: 9 },
  "gemini-3-flash-preview": { input: 0.5, cachedInput: 0.05, output: 3 },
};

function loadPricing(): Record<string, ModelPricing> {
  const merged: Record<string, ModelPricing> = { ...DEFAULT_PRICING };
  const raw = env.MODEL_PRICING_JSON;
  if (!raw) return merged;
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelPricing>>;
    for (const [model, p] of Object.entries(parsed)) {
      if (
        p &&
        typeof p.input === "number" &&
        typeof p.cachedInput === "number" &&
        typeof p.output === "number"
      ) {
        merged[model] = { input: p.input, cachedInput: p.cachedInput, output: p.output };
      } else {
        logger.warn({ model }, "Ignoring malformed MODEL_PRICING_JSON entry");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to parse MODEL_PRICING_JSON; using default pricing");
  }
  return merged;
}

const MODEL_PRICING = loadPricing();

/**
 * Resolve pricing for a model id, tolerating dated snapshot suffixes such as
 * `gpt-5.6-sol-2026-07-09` by falling back to the undated base id.
 */
export function pricingFor(model: string): ModelPricing | undefined {
  const direct = MODEL_PRICING[model];
  if (direct) return direct;
  // Tolerate the Gemini `models/` resource prefix (e.g. `models/gemini-3.8-flash`).
  if (model.startsWith("models/")) {
    const bare = model.slice("models/".length);
    if (MODEL_PRICING[bare]) return MODEL_PRICING[bare];
  }
  // Tolerate a HuggingFace-style `:provider` routing suffix (e.g.
  // `zai-org/GLM-5.2:together`) by falling back to the bare model id.
  const withoutProvider = model.replace(/:[^:]+$/, "");
  if (withoutProvider !== model && MODEL_PRICING[withoutProvider]) {
    return MODEL_PRICING[withoutProvider];
  }
  const base = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return MODEL_PRICING[base];
}

const unknownModelsWarned = new Set<string>();

/**
 * Compute the USD cost of a single response from its usage object. Returns 0
 * (and warns once) when the model has no configured pricing so missing rates
 * never break a solve.
 */
export function computeCostUsd(model: string, usage: UsageLike): number {
  const pricing = pricingFor(model);
  if (!pricing) {
    if (!unknownModelsWarned.has(model)) {
      unknownModelsWarned.add(model);
      logger.warn({ model }, "No pricing configured for model; cost recorded as 0");
    }
    return 0;
  }
  const inputTokens = usage.input_tokens ?? 0;
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (nonCachedInput * pricing.input +
      cachedTokens * pricing.cachedInput +
      outputTokens * pricing.output) /
    1_000_000
  );
}
