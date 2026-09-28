import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { HttpError } from "../lib/httpError.js";

type ValidateTarget = "body" | "query" | "params";

export function validate(schema: ZodSchema, target: ValidateTarget = "body") {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(HttpError.badRequest("Validation failed", result.error.flatten()));
    }
    req[target] = result.data;
    next();
  };
  // Read by the OpenAPI generator (src/docs/openapi.ts) to document request shapes
  return Object.assign(middleware, { openapi: { validate: { schema, target } } });
}
