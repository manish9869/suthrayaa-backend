import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { logAudit } from "../rbac/audit.service.js";
import { PERMISSIONS, isValidPermissionSlug } from "../rbac/permissions.catalog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminRolesRouter = Router();
export const adminPermissionsRouter = Router();
for (const r of [adminRolesRouter, adminPermissionsRouter]) r.use(authenticate, requireAdmin);

const SLUG_TO_GROUP = new Map(PERMISSIONS.map((p) => [p.slug, p.group]));

adminPermissionsRouter.get("/", requirePermission("roles.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("permissions").select("id, name, slug, resource, action, description").order("resource");
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map((p) => ({ ...p, group: SLUG_TO_GROUP.get(p.slug) ?? "Other" })));
  } catch (err) {
    next(err);
  }
});

adminRolesRouter.get("/", requirePermission("roles.view"), async (_req, res, next) => {
  try {
    const { data: roles, error } = await supabaseAdmin.from("roles").select("*").order("is_system_role", { ascending: false }).order("name");
    if (error) throw HttpError.internal(error.message);

    const { data: rolePerms } = await supabaseAdmin.from("role_permissions").select("role_id");
    const { data: userRoles } = await supabaseAdmin.from("user_roles").select("role_id");
    const permCountByRole = new Map<string, number>();
    for (const rp of (rolePerms ?? []) as any[]) permCountByRole.set(rp.role_id, (permCountByRole.get(rp.role_id) ?? 0) + 1);
    const userCountByRole = new Map<string, number>();
    for (const ur of (userRoles ?? []) as any[]) userCountByRole.set(ur.role_id, (userCountByRole.get(ur.role_id) ?? 0) + 1);

    res.json(
      (roles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        isSystemRole: r.is_system_role,
        permissionCount: r.slug === "super-admin" ? PERMISSIONS.length : permCountByRole.get(r.id) ?? 0,
        userCount: userCountByRole.get(r.id) ?? 0,
      }))
    );
  } catch (err) {
    next(err);
  }
});

adminRolesRouter.get("/:id", requirePermission("roles.view"), async (req, res, next) => {
  try {
    const { data: role, error } = await supabaseAdmin.from("roles").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!role) throw HttpError.notFound("Role not found");

    const { data: perms } = await supabaseAdmin.from("role_permissions").select("permissions(slug)").eq("role_id", role.id);
    const permissionSlugs =
      role.slug === "super-admin" ? PERMISSIONS.map((p) => p.slug) : ((perms ?? []) as any[]).map((p) => p.permissions?.slug).filter(Boolean);

    res.json({
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystemRole: role.is_system_role,
      permissions: permissionSlugs,
    });
  } catch (err) {
    next(err);
  }
});

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).default([]),
});

adminRolesRouter.post("/", requirePermission("roles.create"), validate(createRoleSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createRoleSchema>;
    const invalid = body.permissions.filter((p) => !isValidPermissionSlug(p));
    if (invalid.length) throw HttpError.badRequest(`Unknown permission(s): ${invalid.join(", ")}`);

    const slug = body.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const { data: existing } = await supabaseAdmin.from("roles").select("id").eq("slug", slug).maybeSingle();
    if (existing) throw HttpError.badRequest(`A role named "${body.name}" already exists`);

    const { data: role, error } = await supabaseAdmin
      .from("roles")
      .insert({ name: body.name, slug, description: body.description ?? "", is_system_role: false })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);

    if (body.permissions.length) {
      const { data: permRows } = await supabaseAdmin.from("permissions").select("id, slug").in("slug", body.permissions);
      await supabaseAdmin
        .from("role_permissions")
        .insert((permRows ?? []).map((p) => ({ role_id: role.id, permission_id: p.id })));
    }

    await logAudit({ userId: req.admin!.id, action: "ROLE_CREATED", resource: "roles", resourceId: role.id, permission: "roles.create", metadata: { name: role.name }, req });
    res.status(201).json({ id: role.id, name: role.name, slug: role.slug, description: role.description, isSystemRole: false, permissions: body.permissions });
  } catch (err) {
    next(err);
  }
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

adminRolesRouter.patch("/:id", requirePermission("roles.update"), validate(updateRoleSchema), async (req, res, next) => {
  try {
    const { data: role } = await supabaseAdmin.from("roles").select("*").eq("id", req.params.id).maybeSingle();
    if (!role) throw HttpError.notFound("Role not found");
    if (role.is_system_role) throw HttpError.forbidden("System roles cannot be edited.");

    const body = req.body as z.infer<typeof updateRoleSchema>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;

    const { data, error } = await supabaseAdmin.from("roles").update(update).eq("id", req.params.id).select("*").single();
    if (error) throw HttpError.internal(error.message);

    await logAudit({ userId: req.admin!.id, action: "ROLE_UPDATED", resource: "roles", resourceId: role.id, permission: "roles.update", req });
    res.json({ id: data.id, name: data.name, slug: data.slug, description: data.description, isSystemRole: data.is_system_role });
  } catch (err) {
    next(err);
  }
});

adminRolesRouter.delete("/:id", requirePermission("roles.delete"), async (req, res, next) => {
  try {
    const { data: role } = await supabaseAdmin.from("roles").select("*").eq("id", req.params.id).maybeSingle();
    if (!role) throw HttpError.notFound("Role not found");
    if (role.is_system_role) throw HttpError.forbidden("System roles cannot be deleted.");

    const { count } = await supabaseAdmin.from("user_roles").select("id", { count: "exact", head: true }).eq("role_id", role.id);
    if ((count ?? 0) > 0) throw HttpError.conflict(`${count} user(s) currently have this role. Reassign them first.`);

    const { error } = await supabaseAdmin.from("roles").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);

    await logAudit({ userId: req.admin!.id, action: "ROLE_DELETED", resource: "roles", resourceId: role.id, permission: "roles.delete", metadata: { name: role.name }, req });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

const permissionsSchema = z.object({ permissions: z.array(z.string()) });

adminRolesRouter.patch(
  "/:id/permissions",
  requirePermission("roles.assign_permissions"),
  validate(permissionsSchema),
  async (req, res, next) => {
    try {
      const { data: role } = await supabaseAdmin.from("roles").select("*").eq("id", req.params.id).maybeSingle();
      if (!role) throw HttpError.notFound("Role not found");
      if (role.is_system_role) throw HttpError.forbidden("System roles' permissions cannot be edited.");

      const { permissions } = req.body as z.infer<typeof permissionsSchema>;
      const invalid = permissions.filter((p) => !isValidPermissionSlug(p));
      if (invalid.length) throw HttpError.badRequest(`Unknown permission(s): ${invalid.join(", ")}`);

      const { data: permRows } = await supabaseAdmin.from("permissions").select("id, slug").in("slug", permissions);

      await supabaseAdmin.from("role_permissions").delete().eq("role_id", role.id);
      if (permRows?.length) {
        await supabaseAdmin.from("role_permissions").insert(permRows.map((p) => ({ role_id: role.id, permission_id: p.id })));
      }

      await logAudit({
        userId: req.admin!.id,
        action: "PERMISSIONS_CHANGED",
        resource: "roles",
        resourceId: role.id,
        permission: "roles.assign_permissions",
        metadata: { name: role.name, permissionCount: permissions.length },
        req,
      });
      res.json({ id: role.id, permissions });
    } catch (err) {
      next(err);
    }
  }
);
