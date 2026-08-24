import { supabaseAdmin } from "../src/config/supabase.js";

async function main() {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) throw error;
  if (data.users.length === 0) {
    console.log("No auth users yet.");
    return;
  }
  for (const u of data.users) {
    console.log(`${u.id}  ${u.email ?? u.phone ?? "(no email/phone)"}  created ${u.created_at}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
