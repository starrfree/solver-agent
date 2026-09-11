import { NextFunction, Request, RequestHandler, Response } from "express";

import { BadRequestError } from "./errors";

/**
 * Wrap an async Express handler so rejections propagate to the error
 * middleware instead of crashing the process.
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(
  handler: (req: Req, res: Res, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as Req, res as Res, next)).catch(next);
  };
}

/**
 * Express 5 types `req.params[name]` as `string | string[] | undefined`.
 * In practice for normal route params it is always a single string; this
 * helper narrows the type and rejects the request otherwise.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value === "string" && value.length > 0) return value;
  throw new BadRequestError(`Missing path parameter '${name}'`);
}
