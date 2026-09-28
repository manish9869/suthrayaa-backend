import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { logger } from "../../lib/logger.js";

export const AUDIT_ACTIONS = [
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DEACTIVATED",
  // Not in the spec's literal event list, but "deactivated" would misrepresent an account
  // that's actually gone (auth user + admin_users row removed, not just is_active=false).
  "USER_DELETED",
  "ROLE_CREATED",
  "ROLE_UPDATED",
  "ROLE_DELETED",
  "PERMISSIONS_CHANGED",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_DELETED",
  "ORDER_UPDATED",
  "ORDER_CANCELLED",
  "ORDER_REFUNDED",
  "SETTINGS_UPDATED",
  "CONTENT_UPDATED",
  "REPORT_EXPORTED",
  "DATA_EXPORTED",
  "ADMIN_LOGIN",
  "ADMIN_LOGIN_FAILED",
  "ADMIN_LOGOUT",
  "EMAIL_SENT",
  // Written by auditWrites() below
  "RETURN_UPDATED",
  "COUPON_CREATED",
  "COUPON_UPDATED",
  "COUPON_DELETED",
  "CATEGORY_CREATED",
  "CATEGORY_UPDATED",
  "CATEGORY_DELETED",
  "COLOR_CREATED",
  "COLOR_UPDATED",
  "COLOR_DELETED",
  "TESTIMONIAL_CREATED",
  "TESTIMONIAL_UPDATED",
  "TESTIMONIAL_DELETED",
  "HERO_SLIDE_CREATED",
  "HERO_SLIDE_UPDATED",
  "HERO_SLIDE_DELETED",
  "REVIEW_CREATED",
  "REVIEW_UPDATED",
  "REVIEW_DELETED",
  "EMAIL_TEMPLATE_CREATED",
  "EMAIL_TEMPLATE_UPDATED",
  "EMAIL_TEMPLATE_DELETED",
  "SUBSCRIBER_CREATED",
  "SUBSCRIBER_UPDATED",
  "SUBSCRIBER_DELETED",
  "OPTION_TEMPLATE_CREATED",
  "OPTION_TEMPLATE_UPDATED",
  "OPTION_TEMPLATE_DELETED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

interface LogAuditInput {
  userId: string;
  action: AuditAction;
  resource: string;
  resourceId?: string | null;
  permission?: string | null;
  /** Never pass passwords, tokens, or other secrets here — this is stored as-is. */
  metadata?: Record<string, unknown>;
  req?: Request;
}

/** Best-effort: a logging failure must never fail the admin action it's recording. */
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("audit_logs").insert({
      user_id: input.userId,
      action: input.action,
      resource: input.resource,
      resource_id: input.resourceId ?? null,
      permission: input.permission ?? null,
      metadata: input.metadata ?? {},
      ip_address: input.req?.ip ?? null,
      user_agent: input.req?.headers["user-agent"] ?? null,
    });
    if (error) throw error;
  } catch (err) {
    logger.error({ err, action: input.action, resource: input.resource }, "Failed to write audit log");
  }
}

const SECRET_KEYS = /pass(word)?|secret|token|api[_-]?key|otp/i;

/** The request body as a compact audit record: field names always, values only when short, secrets never. */
function summarizeBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted]";
    else if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.length <= 120 ? v : `${v.slice(0, 117)}…`;
    else out[k] = Array.isArray(v) ? `[${v.length} items]` : "{…}";
  }
  return out;
}

/**
 * Router middleware that audits every successful write (POST/PUT/PATCH/DELETE answered 2xx) as
 * `<prefix>_CREATED | _UPDATED | _DELETED`, with the record id and the fields sent. Use on
 * routers whose handlers don't call logAudit themselves. `routes` maps a route path to a
 * specific action, or to null for POSTs that change nothing (previews).
 */
export function auditWrites(resource: string, prefix: string, routes: Record<string, AuditAction | null> = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    // Remember the id of whatever the handler returns, so a create is logged against the new record
    let createdId: string | null = null;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      const id = (body as { id?: unknown } | null)?.id;
      if (typeof id === "string") createdId = id;
      return json(body);
    };
    res.on("finish", () => {
      if (res.statusCode >= 400 || !req.admin) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const routePath: string | undefined = (req as any).route?.path;
      let action: AuditAction | null;
      if (routePath !== undefined && routePath in routes) action = routes[routePath];
      else {
        const verb = req.method === "POST" ? "CREATED" : req.method === "DELETE" ? "DELETED" : "UPDATED";
        action = `${prefix}_${verb}` as AuditAction;
      }
      if (!action || !(AUDIT_ACTIONS as readonly string[]).includes(action)) return;
      void logAudit({
        userId: req.admin.id,
        action,
        resource,
        resourceId: req.params?.id ?? createdId,
        metadata: { route: `${req.method} ${req.baseUrl}${routePath ?? ""}`, changes: summarizeBody(req.body) },
        req,
      });
    });
    next();
  };
}
