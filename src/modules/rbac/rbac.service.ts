import { supabaseAdmin } from "../../config/supabase.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SUPER_ADMIN_SLUG = "super-admin";

export interface UserRole {
  id: string;
  name: string;
  slug: string;
}

export interface UserRbac {
  isSuperAdmin: boolean;
  permissions: Set<string>;
  roles: UserRole[];
}

/**
 * Loads a user's effective roles + permissions fresh from the DB (no cache, no JWT
 * embedding) — mirrors requireAdmin's existing "re-check every request" behavior so a
 * revoked role or removed permission takes effect on the very next request.
 */
export async function getUserRbac(userId: string): Promise<UserRbac> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("roles(id, name, slug, role_permissions(permissions(slug)))")
    .eq("user_id", userId);
  if (error) throw error;

  const roles: UserRole[] = [];
  const permissions = new Set<string>();
  let isSuperAdmin = false;

  for (const row of (data ?? []) as any[]) {
    const role = row.roles;
    if (!role) continue;
    roles.push({ id: role.id, name: role.name, slug: role.slug });
    if (role.slug === SUPER_ADMIN_SLUG) isSuperAdmin = true;
    for (const rp of role.role_permissions ?? []) {
      if (rp.permissions?.slug) permissions.add(rp.permissions.slug);
    }
  }

  return { isSuperAdmin, permissions, roles };
}

export function can(rbac: UserRbac, permission: string): boolean {
  return rbac.isSuperAdmin || rbac.permissions.has(permission);
}

export function hasAnyPermission(rbac: UserRbac, perms: string[]): boolean {
  return rbac.isSuperAdmin || perms.some((p) => rbac.permissions.has(p));
}

export function hasRole(rbac: UserRbac, slug: string): boolean {
  return rbac.roles.some((r) => r.slug === slug);
}

/** Count of currently-active admin_users holding the super-admin role — used by the "can't
 * remove the last Super Admin" safeguards before any destructive/demoting mutation. */
export async function countActiveSuperAdmins(): Promise<number> {
  const { data: superAdminRole } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("slug", SUPER_ADMIN_SLUG)
    .maybeSingle();
  if (!superAdminRole) return 0;

  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, admin_users!inner(is_active)")
    .eq("role_id", superAdminRole.id)
    .eq("admin_users.is_active", true);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.user_id)).size;
}

export async function getSuperAdminRoleId(): Promise<string | null> {
  const { data } = await supabaseAdmin.from("roles").select("id").eq("slug", SUPER_ADMIN_SLUG).maybeSingle();
  return data?.id ?? null;
}
