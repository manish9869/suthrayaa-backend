import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminAuditLogsRouter = Router();
adminAuditLogsRouter.use(authenticate, requireAdmin);

adminAuditLogsRouter.get("/", requirePermission("audit_logs.view"), async (req, res, next) => {
  try {
    const { userId, action, resource, from, to, page = "1", limit = "50" } = req.query as Record<string, string>;
    let query = supabaseAdmin.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (userId) query = query.eq("user_id", userId);
    if (action) query = query.eq("action", action);
    if (resource) query = query.eq("resource", resource);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(300, Math.max(1, Number(limit) || 50));
    query = query.range((pageNum - 1) * limitNum, pageNum * limitNum - 1);

    const { data, error, count } = await query;
    if (error) throw HttpError.internal(error.message);

    const userIds = Array.from(new Set((data ?? []).map((l: any) => l.user_id).filter(Boolean)));
    const namesByUser = new Map<string, string | null>();
    if (userIds.length) {
      const { data: users } = await supabaseAdmin.from("admin_users").select("id, display_name").in("id", userIds);
      for (const u of users ?? []) namesByUser.set(u.id, u.display_name);
    }

    res.json({
      items: (data ?? []).map((l: any) => ({
        id: l.id,
        userId: l.user_id,
        userName: l.user_id ? namesByUser.get(l.user_id) ?? "Unknown" : "System",
        action: l.action,
        resource: l.resource,
        resourceId: l.resource_id,
        permission: l.permission,
        metadata: l.metadata,
        ipAddress: l.ip_address,
        userAgent: l.user_agent,
        createdAt: l.created_at,
      })),
      total: count ?? 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});
