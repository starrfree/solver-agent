import { env } from "../config/env";
import { ReasoningSpeed } from "../db/types";
import { ComputationResult, runComputationSubAgent } from "./symbolicAgent";
import { CY_ANALYST_AGENT_PROMPT } from "./systemPrompts";

export async function runCyAnalystAgent(input: {
  task: string;
  context?: string;
  reasoningSpeed: ReasoningSpeed;
  signal?: AbortSignal;
}): Promise<ComputationResult> {
  return runComputationSubAgent({
    instructions: CY_ANALYST_AGENT_PROMPT,
    promptCacheKey: "cy-analyst-agent",
    reasoningRole: "cy_analyst",
    task: input.task,
    reasoningSpeed: input.reasoningSpeed,
    // Heavy budget so triangulations / cone computations have room to finish.
    pythonTimeoutMs: env.PYTHON_HEAVY_TIMEOUT_MS,
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}
