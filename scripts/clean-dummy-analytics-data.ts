/**
 * Removes everything created by seed-dummy-analytics-data.ts: orders whose order_number
 * starts with "TEST-" (order_items cascade-delete with them), plus test customer accounts
 * (email ending in "@example.com" with the "testcustomer" prefix).
 *
 * Usage: pnpm tsx scripts/clean-dummy-analytics-data.ts
 */
import { supabaseAdmin } from "../src/config/supabase.js";

async function main() {
  const { data: orders, error: ordersErr } = await supabaseAdmin.from("orders").select("id, order_number").like("order_number", "TEST-%");
  if (ordersErr) throw ordersErr;
  if (orders && orders.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("orders")
      .delete()
      .in("id", orders.map((o) => o.id));
    if (delErr) throw delErr;
    console.log(`Deleted ${orders.length} test orders (order_items cascaded).`);
  } else {
    console.log("No test orders found.");
  }

  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from("customer_profiles")
    .select("id, email")
    .like("email", "testcustomer%@example.com");
  if (profilesErr) throw profilesErr;
  if (profiles && profiles.length > 0) {
    for (const p of profiles) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(p.id);
      if (error) console.warn(`  failed to delete auth user ${p.email}: ${error.message}`);
    }
    console.log(`Deleted ${profiles.length} test customers (customer_profiles cascaded via auth.users).`);
  } else {
    console.log("No test customers found.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
