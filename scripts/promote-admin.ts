/**
 * One-time bootstrap: grants admin_users access to an existing Supabase Auth user by email.
 * Usage: pnpm tsx scripts/promote-admin.ts someone@example.com [role]
 */
import { supabaseAdmin } from "../src/config/supabase.js";

async function main() {
  const email = process.argv[2];
  const role = process.argv[3] ?? "super_admin";
  if (!email) {
    console.error("Usage: tsx scripts/promote-admin.ts <email> [role]");
    process.exit(1);
  }

  const { data, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) throw error;

  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`No auth user found with email "${email}". They need to sign in at least once first.`);
    process.exit(1);
  }

  const { error: upsertError } = await supabaseAdmin
    .from("admin_users")
    .upsert({ id: user.id, role, display_name: user.email }, { onConflict: "id" });
  if (upsertError) throw upsertError;

  console.log(`Granted "${role}" admin access to ${email} (${user.id}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
