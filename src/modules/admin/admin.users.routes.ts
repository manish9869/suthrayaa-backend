import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/httpError.js";
import { logAudit } from "../rbac/audit.service.js";
import { getUserRbac, countActiveSuperAdmins, SUPER_ADMIN_SLUG } from "../rbac/rbac.service.js";
import { resendLoggedEmail, wrapEmail } from "../email/email.service.js";
import { logger } from "../../lib/logger.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminUsersRouter = Router();
adminUsersRouter.use(authenticate, requireAdmin);

async function authUsersByIds(ids: string[]) {
  const map = new Map<string, { email: string | null; lastSignInAt: string | null }>();
  if (!ids.length) return map;
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw HttpError.internal(error.message);
  for (const u of data.users) {
    if (ids.includes(u.id)) map.set(u.id, { email: u.email ?? null, lastSignInAt: u.last_sign_in_at ?? null });
  }
  return map;
}

async function rolesByUserIds(ids: string[]) {
  const map = new Map<string, { id: string; name: string; slug: string }[]>();
  if (!ids.length) return map;
  const { data, error } = await supabaseAdmin.from("user_roles").select("user_id, roles(id, name, slug)").in("user_id", ids);
  if (error) throw HttpError.internal(error.message);
  for (const row of (data ?? []) as any[]) {
    const list = map.get(row.user_id) ?? [];
    if (row.roles) list.push(row.roles);
    map.set(row.user_id, list);
  }
  return map;
}

adminUsersRouter.get("/", requirePermission("users.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("id, display_name, is_active, created_at")
      .order("created_at", { ascending: false });
    if (error) throw HttpError.internal(error.message);

    const ids = (data ?? []).map((u) => u.id);
    const [authMap, rolesMap] = await Promise.all([authUsersByIds(ids), rolesByUserIds(ids)]);

    res.json(
      (data ?? []).map((u) => ({
        id: u.id,
        displayName: u.display_name,
        isActive: u.is_active,
        createdAt: u.created_at,
        email: authMap.get(u.id)?.email ?? null,
        lastLoginAt: authMap.get(u.id)?.lastSignInAt ?? null,
        roles: rolesMap.get(u.id) ?? [],
      }))
    );
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.get("/:id", requirePermission("users.view"), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("id, display_name, is_active, created_at")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("User not found");

    const [authMap, rbac] = await Promise.all([authUsersByIds([data.id]), getUserRbac(data.id)]);

    res.json({
      id: data.id,
      displayName: data.display_name,
      isActive: data.is_active,
      createdAt: data.created_at,
      email: authMap.get(data.id)?.email ?? null,
      lastLoginAt: authMap.get(data.id)?.lastSignInAt ?? null,
      roles: rbac.roles,
      permissions: Array.from(rbac.permissions),
      isSuperAdmin: rbac.isSuperAdmin,
    });
  } catch (err) {
    next(err);
  }
});

const updateUserSchema = z.object({
  displayName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

adminUsersRouter.patch("/:id", requirePermission("users.update"), validate(updateUserSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateUserSchema>;

    if (body.isActive === false) {
      const rbac = await getUserRbac(req.params.id);
      if (rbac.roles.some((r) => r.slug === SUPER_ADMIN_SLUG)) {
        const { data: target } = await supabaseAdmin.from("admin_users").select("is_active").eq("id", req.params.id).maybeSingle();
        if (target?.is_active && (await countActiveSuperAdmins()) <= 1) {
          throw HttpError.badRequest("Cannot deactivate the last active Super Admin.");
        }
      }
    }

    const update: Record<string, unknown> = {};
    if (body.displayName !== undefined) update.display_name = body.displayName;
    if (body.isActive !== undefined) update.is_active = body.isActive;
    if (!Object.keys(update).length) throw HttpError.badRequest("No changes provided");

    const { data, error } = await supabaseAdmin.from("admin_users").update(update).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("User not found");

    await logAudit({
      userId: req.admin!.id,
      action: body.isActive === false ? "USER_DEACTIVATED" : "USER_UPDATED",
      resource: "users",
      resourceId: req.params.id,
      permission: "users.update",
      metadata: { fields: Object.keys(update) },
      req,
    });
    res.json({ id: data.id, displayName: data.display_name, isActive: data.is_active });
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.delete("/:id", requirePermission("users.delete"), async (req, res, next) => {
  try {
    if (req.admin!.id === req.params.id) throw HttpError.badRequest("You cannot delete your own account.");

    const rbac = await getUserRbac(req.params.id);
    if (rbac.roles.some((r) => r.slug === SUPER_ADMIN_SLUG)) {
      const { data: target } = await supabaseAdmin.from("admin_users").select("is_active").eq("id", req.params.id).maybeSingle();
      if (!target) throw HttpError.notFound("User not found");
      if (target.is_active && (await countActiveSuperAdmins()) <= 1) {
        throw HttpError.badRequest("Cannot delete the last active Super Admin.");
      }
    }

    // admin_users.id -> auth.users(id) on delete cascade, and user_roles.user_id -> admin_users(id)
    // on delete cascade, so removing the auth user cleanly removes both in one call.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
    if (error) throw HttpError.internal(error.message);

    await logAudit({ userId: req.admin!.id, action: "USER_DELETED", resource: "users", resourceId: req.params.id, permission: "users.delete", req });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const roleIdSchema = z.object({ roleId: z.string().uuid() });

adminUsersRouter.post("/:id/roles", requirePermission("users.assign_role"), validate(roleIdSchema), async (req, res, next) => {
  try {
    const { roleId } = req.body as z.infer<typeof roleIdSchema>;
    const { data: role } = await supabaseAdmin.from("roles").select("id, name, slug").eq("id", roleId).maybeSingle();
    if (!role) throw HttpError.notFound("Role not found");

    if (role.slug === SUPER_ADMIN_SLUG && !req.rbac!.isSuperAdmin) {
      throw HttpError.forbidden("Only a Super Admin can grant the Super Admin role.");
    }

    const { error } = await supabaseAdmin.from("user_roles").upsert({ user_id: req.params.id, role_id: roleId }, { onConflict: "user_id,role_id" });
    if (error) throw HttpError.internal(error.message);

    await logAudit({
      userId: req.admin!.id,
      action: "USER_UPDATED",
      resource: "users",
      resourceId: req.params.id,
      permission: "users.assign_role",
      metadata: { addedRole: role.slug },
      req,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.delete("/:id/roles/:roleId", requirePermission("users.assign_role"), async (req, res, next) => {
  try {
    const { data: role } = await supabaseAdmin.from("roles").select("id, name, slug").eq("id", req.params.roleId).maybeSingle();
    if (!role) throw HttpError.notFound("Role not found");

    if (role.slug === SUPER_ADMIN_SLUG) {
      if (!req.rbac!.isSuperAdmin) throw HttpError.forbidden("Only a Super Admin can remove the Super Admin role.");
      const { data: target } = await supabaseAdmin.from("admin_users").select("is_active").eq("id", req.params.id).maybeSingle();
      if (target?.is_active && (await countActiveSuperAdmins()) <= 1) {
        throw HttpError.badRequest("Cannot remove the Super Admin role from the last active Super Admin.");
      }
    }

    const { error } = await supabaseAdmin.from("user_roles").delete().eq("user_id", req.params.id).eq("role_id", req.params.roleId);
    if (error) throw HttpError.internal(error.message);

    await logAudit({
      userId: req.admin!.id,
      action: "USER_UPDATED",
      resource: "users",
      resourceId: req.params.id,
      permission: "users.assign_role",
      metadata: { removedRole: role.slug },
      req,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.post("/:id/reset-password", requirePermission("users.update"), async (req, res, next) => {
  try {
    const { data: authUser, error: getErr } = await supabaseAdmin.auth.admin.getUserById(req.params.id);
    if (getErr || !authUser?.user?.email) throw HttpError.notFound("User not found");

    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: authUser.user.email,
    });
    if (linkErr || !link?.properties?.action_link) throw HttpError.internal("Failed to generate a reset link");

    try {
      const html = wrapEmail(
        "Reset your Suthrayaa admin password",
        `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3a2420;margin:0 0 20px;line-height:1.6;">
           A password reset was requested for your Suthrayaa admin account. Click below to choose a new password. If you didn't request this, you can ignore this email.
         </p>
         <p style="text-align:center;margin:24px 0;">
           <a href="${link.properties.action_link}" style="display:inline-block;background:#c1502e;color:#fff;text-decoration:none;padding:12px 28px;border-radius:100px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">Reset Password</a>
         </p>`
      );
      await resendLoggedEmail(authUser.user.email, "Reset your Suthrayaa admin password", html);
    } catch (err) {
      logger.warn({ err }, "Reset-password email could not be sent — link still generated");
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Invite-based registration ----
// New admins are never created directly by another admin typing a password on their behalf.
// An invite is a single-use, expiring token; the invitee sets their own password at
// /admin/register/[token] on the frontend — a route that isn't linked anywhere in the app.

const inviteSchema = z.object({
  email: z.string().email(),
  roleIds: z.array(z.string().uuid()).min(1),
});

adminUsersRouter.post(
  "/invite",
  requirePermission("users.create"),
  requirePermission("users.assign_role"),
  validate(inviteSchema),
  async (req, res, next) => {
    try {
      const { email, roleIds } = req.body as z.infer<typeof inviteSchema>;

      const { data: roles, error: rolesErr } = await supabaseAdmin.from("roles").select("id, name, slug").in("id", roleIds);
      if (rolesErr) throw HttpError.internal(rolesErr.message);
      if (!roles || roles.length !== roleIds.length) throw HttpError.badRequest("One or more roles do not exist");
      if (roles.some((r) => r.slug === SUPER_ADMIN_SLUG) && !req.rbac!.isSuperAdmin) {
        throw HttpError.forbidden("Only a Super Admin can invite someone as a Super Admin.");
      }

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { error: insertErr } = await supabaseAdmin.from("admin_invites").insert({
        email,
        invited_by: req.admin!.id,
        role_ids: roleIds,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });
      if (insertErr) throw HttpError.internal(insertErr.message);

      const inviteUrl = `${env.FRONTEND_URL}/admin/register/${token}`;
      const roleNames = roles.map((r) => r.name).join(", ");

      try {
        const html = wrapEmail(
          "You've been invited to Suthrayaa Admin",
          `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3a2420;margin:0 0 20px;line-height:1.6;">
             You've been invited to join the Suthrayaa admin panel as <strong>${roleNames}</strong>. This link is valid for 7 days and can only be used once.
           </p>
           <p style="text-align:center;margin:24px 0;">
             <a href="${inviteUrl}" style="display:inline-block;background:#c1502e;color:#fff;text-decoration:none;padding:12px 28px;border-radius:100px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">Accept Invite</a>
           </p>`
        );
        await resendLoggedEmail(email, "You've been invited to Suthrayaa Admin", html);
      } catch (err) {
        logger.warn({ err }, "Invite email could not be sent — link still generated");
      }

      res.status(201).json({ inviteUrl, email, roles: roles.map((r) => ({ id: r.id, name: r.name, slug: r.slug })), expiresAt });
    } catch (err) {
      next(err);
    }
  }
);
