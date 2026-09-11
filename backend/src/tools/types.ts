import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses";

import { Conversation, Ledger, ReasoningSpeed } from "../db/types";

export interface ToolContext {
  conversation: Conversation;
  ledger: Ledger;
  /**
   * Per-call buffer that handlers may push extra Responses API input items
   * into. The agent loop appends them right after the matching
   * `function_call_output`, so they reach the model on the next turn.
   * Used today by `fetch_artifact_file` to deliver inline images via an
   * `input_image` content part when the file is a picture.
   */
  extraInputItems: ResponseInputItem[];
  /**
   * Reasoning speed for sub-agents spawned from this turn. Resolved from
   * the conversation document at the start of a solver run and then read
   * by every tool handler that delegates to a sub-agent.
   */
  reasoningSpeed: ReasoningSpeed;
  /**
   * Abort signal forwarded by the orchestrator. Tool handlers and the
   * sub-agents they spawn should pass this signal into their own
   * `createResponse` calls so that pausing the solver run interrupts
   * in-flight model calls quickly.
   */
  signal?: AbortSignal;
}

export type ToolHandler = (
  ctx: ToolContext,
  call: ResponseFunctionToolCall,
) => Promise<string>;
