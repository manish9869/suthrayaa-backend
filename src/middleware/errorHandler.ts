import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
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
    if (err.status >= 500) {
      // Server-side failures often carry raw database/driver text — log it, never return it
      logger.error({ err, path: req.path }, err.message);
      return res.status(err.status).json({ error: { message: "Something went wrong on our side. Please try again.", code: err.code } });
    }
    return res.status(err.status).json({
      error: { message: err.message, code: err.code, details: err.details },
    });
  }
  // Upload limits from multer (e.g. LIMIT_FILE_SIZE) are client errors, not server faults
  if (err instanceof MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({
      error: { message: tooLarge ? "Image is too large — please use one under 4 MB" : err.message, code: "BAD_REQUEST" },
    });
  }
  // Malformed JSON bodies and oversized payloads from body-parser
  const status = (err as { status?: number; type?: string })?.status
  if (status === 400 || status === 413) {
    return res.status(status).json({ error: { message: status === 413 ? "Request is too large" : "Malformed request body", code: "BAD_REQUEST" } });
  }

  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: { message: "Internal server error", code: "INTERNAL" } });
}
