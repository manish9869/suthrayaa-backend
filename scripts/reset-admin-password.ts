import { supabaseAdmin } from "../src/config/supabase.js";

async function main() {
  const userId = process.argv[2];
  const newPassword = process.argv[3];
  if (!userId || !newPassword) {
    console.error("Usage: tsx scripts/reset-admin-password.ts <userId> <newPassword>");
    process.exit(1);
  }
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) throw error;
  console.log(`Password updated for ${data.user.email}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
