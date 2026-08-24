/**
 * One-time bootstrap: creates a Supabase Auth user (email+password) and grants it
 * admin_users access in one step. Usage: pnpm tsx scripts/create-admin.ts <email> <password>
 */
import { supabaseAdmin } from "../src/config/supabase.js";

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: tsx scripts/create-admin.ts <email> <password>");
    process.exit(1);
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const { error: upsertError } = await supabaseAdmin
    .from("admin_users")
    .upsert({ id: data.user.id, role: "super_admin", display_name: email }, { onConflict: "id" });
  if (upsertError) throw upsertError;

  console.log(`Created admin account for ${email} (${data.user.id}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
