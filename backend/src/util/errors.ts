/**
 * Typed error hierarchy. The agent loops surface tool failures as
 * `function_call_output` payloads (see `tools/*.ts`), so these are mostly
 * used at the HTTP boundary and inside the Python runner wrapper.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(404, "not_found", message, details);
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, "bad_request", message, details);
    this.name = "BadRequestError";
  }
}

export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(409, "conflict", message, details);
    this.name = "ConflictError";
  }
}

/** Raised inside a tool when an unrecoverable error must reach the model as text. */
export class ToolError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export class TimeoutError extends ToolError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, message?: string) {
    super("timeout", message ?? `Operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
