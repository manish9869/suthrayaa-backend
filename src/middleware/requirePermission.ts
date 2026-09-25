import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../lib/httpError.js";
import { can, hasAnyPermission } from "../modules/rbac/rbac.service.js";

/**
 * Requires a single permission slug. Must run after `authenticate` + `requireAdmin` (which
 * populate req.rbac). Super Admin bypasses every check. This is the backend's actual
 * authorization boundary — the frontend hiding a button is UX only, never security.
 */
export function requirePermission(permission: string) {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.rbac) return next(HttpError.forbidden("Admin access required"));
    if (!can(req.rbac, permission)) {
      return next(HttpError.forbidden("You do not have permission to perform this action."));
    }
    next();
  };
  // Read by the OpenAPI generator (src/docs/openapi.ts)
  return Object.assign(middleware, { openapi: { permissions: [permission] } });
}

/** Passes if the user holds ANY of the given permissions (or is Super Admin). */
export function requireAnyPermission(...permissions: string[]) {
  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.rbac) return next(HttpError.forbidden("Admin access required"));
    if (!hasAnyPermission(req.rbac, permissions)) {
      return next(HttpError.forbidden("You do not have permission to perform this action."));
    }
    next();
  };
  return Object.assign(middleware, { openapi: { permissions, any: true } });
}
