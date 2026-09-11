import { env } from "../config/env";
import { ReasoningSpeed } from "../db/types";
import { ComputationResult, runComputationSubAgent } from "./symbolicAgent";
import { NUMERICAL_AGENT_PROMPT } from "./systemPrompts";

export async function runNumericalAgent(input: {
  task: string;
  context?: string;
  reasoningSpeed: ReasoningSpeed;
  signal?: AbortSignal;
}): Promise<ComputationResult> {
  return runComputationSubAgent({
    instructions: NUMERICAL_AGENT_PROMPT,
    promptCacheKey: "numerical-agent",
    task: input.task,
    reasoningSpeed: input.reasoningSpeed,
    // Heavy budget so compiled C++ search / combinatorics can finish.
    pythonTimeoutMs: env.PYTHON_HEAVY_TIMEOUT_MS,
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}
