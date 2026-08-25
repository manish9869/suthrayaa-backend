/**
 * Idempotent RBAC seed — upserts the permission catalog, the 7 default system roles, and
 * each system role's permission grants. Safe to run repeatedly (e.g. after adding a new
 * permission to permissions.catalog.ts); never touches custom (non-system) roles.
 * Usage: pnpm tsx scripts/seed-rbac.ts
 */
import { supabaseAdmin } from "../src/config/supabase.js";
import { PERMISSIONS } from "../src/modules/rbac/permissions.catalog.js";
import { SYSTEM_ROLES } from "../src/modules/rbac/roles.catalog.js";

async function main() {
  console.log(`Seeding ${PERMISSIONS.length} permissions...`);
  for (const p of PERMISSIONS) {
    const { error } = await supabaseAdmin
      .from("permissions")
      .upsert({ name: p.name, slug: p.slug, resource: p.resource, action: p.action, description: p.description }, { onConflict: "slug" });
    if (error) throw new Error(`permissions upsert failed for ${p.slug}: ${error.message}`);
  }

  const { data: allPerms, error: permsErr } = await supabaseAdmin.from("permissions").select("id, slug");
  if (permsErr) throw permsErr;
  const permIdBySlug = new Map((allPerms ?? []).map((p) => [p.slug, p.id]));

  console.log(`Seeding ${SYSTEM_ROLES.length} system roles...`);
  for (const role of SYSTEM_ROLES) {
    const { data: existing } = await supabaseAdmin.from("roles").select("id").eq("slug", role.slug).maybeSingle();

    let roleId: string;
    if (existing) {
      roleId = existing.id;
      const { error } = await supabaseAdmin
        .from("roles")
        .update({ name: role.name, description: role.description, is_system_role: true, updated_at: new Date().toISOString() })
        .eq("id", roleId);
      if (error) throw new Error(`roles update failed for ${role.slug}: ${error.message}`);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("roles")
        .insert({ name: role.name, slug: role.slug, description: role.description, is_system_role: true })
        .select("id")
        .single();
      if (error) throw new Error(`roles insert failed for ${role.slug}: ${error.message}`);
      roleId = inserted.id;
    }

    // Super Admin's grant is a code-level bypass (rbac.service.isSuperAdmin), not a literal
    // permission list — skip writing role_permissions rows for it (nothing checks them).
    if (role.slug === "super-admin") continue;

    // Delete-then-reinsert scoped to THIS system role only — never touches custom roles.
    await supabaseAdmin.from("role_permissions").delete().eq("role_id", roleId);
    const rows = role.permissions
      .map((slug) => permIdBySlug.get(slug))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ role_id: roleId, permission_id: permissionId }));
    if (rows.length) {
      const { error } = await supabaseAdmin.from("role_permissions").insert(rows);
      if (error) throw new Error(`role_permissions insert failed for ${role.slug}: ${error.message}`);
    }
    console.log(`  ${role.slug}: ${rows.length} permissions`);
  }

  console.log("RBAC seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
