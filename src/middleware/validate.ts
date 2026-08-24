import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { HttpError } from "../lib/httpError.js";

type ValidateTarget = "body" | "query" | "params";

export function validate(schema: ZodSchema, target: ValidateTarget = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(HttpError.badRequest("Validation failed", result.error.flatten()));
    }
    req[target] = result.data;
    next();
  };
}
