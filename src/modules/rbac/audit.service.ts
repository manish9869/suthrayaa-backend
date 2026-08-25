import type { Request } from "express";
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
