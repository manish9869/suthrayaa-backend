/**
 * One-time data migration: assigns every existing admin_users row a row in user_roles,
 * mapping its legacy `role` column to a new RBAC role. Run once, after scripts/seed-rbac.ts.
 *
 * The legacy `role` column ('super_admin' | 'admin' | 'staff') never actually differentiated
 * access in the old code — requireAdmin only checked "does a row exist", so all three grant
 * IDENTICAL full access today. To guarantee zero access regression, all three map to
 * super-admin here. This is intentionally broad for 'admin'/'staff': re-assign any such
 * users to a narrower role (Catalog Manager, Order Manager, etc.) via the new Roles UI
 * afterward — this script only guarantees nobody LOSES access they currently have.
 *
 * Idempotent: uses upsert on the (user_id, role_id) unique constraint.
 * Usage: pnpm tsx scripts/migrate-admin-roles.ts
 */
import { supabaseAdmin } from "../src/config/supabase.js";

const LEGACY_ROLE_MAP: Record<string, string> = {
  super_admin: "super-admin",
  admin: "super-admin",
  staff: "super-admin",
};

async function main() {
  const { data: admins, error } = await supabaseAdmin.from("admin_users").select("id, role, display_name");
  if (error) throw error;
  if (!admins?.length) {
    console.log("No admin_users rows found — nothing to migrate.");
    return;
  }

  const { data: roles, error: rolesErr } = await supabaseAdmin.from("roles").select("id, slug");
  if (rolesErr) throw rolesErr;
  const roleIdBySlug = new Map((roles ?? []).map((r) => [r.slug, r.id]));

  for (const admin of admins) {
    const targetSlug = LEGACY_ROLE_MAP[admin.role];
    if (!targetSlug) {
      console.warn(`  ! ${admin.display_name ?? admin.id}: unrecognized legacy role "${admin.role}" — skipped, assign a role manually.`);
      continue;
    }
    const roleId = roleIdBySlug.get(targetSlug);
    if (!roleId) {
      console.warn(`  ! Role "${targetSlug}" not found — did you run scripts/seed-rbac.ts first?`);
      continue;
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: admin.id, role_id: roleId }, { onConflict: "user_id,role_id" });
    if (upsertErr) throw upsertErr;

    const note = admin.role === "super_admin" ? "" : `  (was legacy "${admin.role}" — review and narrow this via the Roles UI)`;
    console.log(`  ${admin.display_name ?? admin.id}: -> ${targetSlug}${note}`);
  }

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
