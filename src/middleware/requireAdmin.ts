import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase.js";
import { HttpError } from "../lib/httpError.js";
import { getUserRbac } from "../modules/rbac/rbac.service.js";

/**
 * Admin gating is re-checked against the admin_users table (and, below, the RBAC tables) on
 * every request rather than trusting a JWT claim, so revoking admin access, deactivating a
 * user, or changing a role's permissions takes effect immediately. Must run after `authenticate`.
 */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) throw HttpError.unauthorized();

    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("id, role, display_name, is_active")
      .eq("id", req.user.id)
      .maybeSingle();

    if (error) throw HttpError.internal("Failed to verify admin access");
    if (!data) throw HttpError.forbidden("Admin access required");
    if (!data.is_active) throw HttpError.forbidden("This admin account has been deactivated");

    req.admin = data as { id: string; role: string; display_name: string | null; is_active: boolean };
    req.rbac = await getUserRbac(data.id);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(HttpError.forbidden("Insufficient admin role"));
    }
    next();
  };
}
