import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/httpError.js";
import { logger } from "../lib/logger.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { message: `Route not found: ${req.method} ${req.path}`, code: "NOT_FOUND" },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error({ err }, err.message);
    return res.status(err.status).json({
      error: { message: err.message, code: err.code, details: err.details },
    });
  }

  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: { message: "Internal server error", code: "INTERNAL" } });
}
