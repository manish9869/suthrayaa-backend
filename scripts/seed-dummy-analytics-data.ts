/**
 * Seeds clearly-marked test data (orders + customers) spread across the last 60 days so the
 * admin dashboard's charts/date filters have something to render while you're testing them.
 * Everything created here is tagged for easy cleanup — see clean-dummy-analytics-data.ts.
 *
 * Usage: pnpm tsx scripts/seed-dummy-analytics-data.ts
 */
import crypto from "node:crypto";
import { supabaseAdmin } from "../src/config/supabase.js";

const DAYS = 60;
const TEST_CUSTOMER_COUNT = 14;
const TEST_ORDER_COUNT = 55;

const PAYMENT_METHODS = ["cod", "upi", "card", "razorpay"] as const;
const FIRST_NAMES = ["Aarav", "Priya", "Rohan", "Ananya", "Vihaan", "Ishita", "Kabir", "Meera", "Aditya", "Sara", "Arjun", "Diya", "Kunal", "Neha"];
const LAST_NAMES = ["Sharma", "Verma", "Iyer", "Nair", "Reddy", "Gupta", "Kapoor", "Joshi", "Chauhan", "Mehta"];
const CITIES = [
  { city: "Bengaluru", state: "Karnataka", pincode: "560001" },
  { city: "Mumbai", state: "Maharashtra", pincode: "400001" },
  { city: "Pune", state: "Maharashtra", pincode: "411001" },
  { city: "Hyderabad", state: "Telangana", pincode: "500001" },
  { city: "Chennai", state: "Tamil Nadu", pincode: "600001" },
  { city: "Delhi", state: "Delhi", pincode: "110001" },
];

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(randomInt(8, 21), randomInt(0, 59), 0, 0);
  return d;
}

async function main() {
  const { data: products, error: productsErr } = await supabaseAdmin
    .from("products")
    .select("id, name, price, sku")
    .eq("is_active", true)
    .limit(20);
  if (productsErr) throw productsErr;
  if (!products || products.length === 0) {
    console.error("No active products found — add products before seeding test orders.");
    process.exit(1);
  }

  // ---- Test customers, backdated so the "New Registrations" chart has a spread ----
  console.log(`Creating ${TEST_CUSTOMER_COUNT} test customers...`);
  const customerIds: string[] = [];
  for (let i = 1; i <= TEST_CUSTOMER_COUNT; i++) {
    const email = `testcustomer${i}@example.com`;
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: crypto.randomBytes(12).toString("hex"),
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (createErr) {
      console.warn(`  skip ${email}: ${createErr.message}`);
      continue;
    }
    const joinedAt = daysAgo(randomInt(0, DAYS));
    await supabaseAdmin
      .from("customer_profiles")
      .update({ first_name: firstName, last_name: lastName, created_at: joinedAt.toISOString() })
      .eq("id", created.user.id);
    customerIds.push(created.user.id);
  }
  console.log(`  created ${customerIds.length} customers.`);

  // ---- Test orders across the window, weighted toward "paid" ----
  console.log(`Creating ${TEST_ORDER_COUNT} test orders...`);
  let created = 0;
  for (let i = 1; i <= TEST_ORDER_COUNT; i++) {
    const roll = Math.random();
    const paymentStatus = roll < 0.68 ? "paid" : roll < 0.8 ? "pending" : roll < 0.92 ? "failed" : roll < 0.97 ? "refunded" : "partially_refunded";
    const status =
      paymentStatus === "paid"
        ? pick(["confirmed", "in_production", "ready", "shipped", "delivered", "delivered"] as const)
        : paymentStatus === "refunded" || paymentStatus === "partially_refunded"
          ? "refunded"
          : paymentStatus === "failed"
            ? "cancelled"
            : "pending_payment";

    const itemCount = randomInt(1, 3);
    const chosen = Array.from({ length: itemCount }, () => pick(products));
    const items = chosen.map((p) => {
      const qty = randomInt(1, 2);
      return { product: p, qty, lineTotal: Number(p.price) * qty };
    });
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
    const shippingCost = subtotal > 999 ? 0 : pick([0, 49, 79, 99]);
    const discountAmount = Math.random() < 0.25 ? Math.round(subtotal * 0.1) : 0;
    const total = subtotal - discountAmount + shippingCost;

    const placedAt = daysAgo(randomInt(0, DAYS));
    const orderNumber = `TEST-${placedAt.getFullYear()}${String(placedAt.getMonth() + 1).padStart(2, "0")}-${String(i).padStart(4, "0")}`;
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const loc = pick(CITIES);
    const useCustomer = customerIds.length > 0 && Math.random() < 0.5;

    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .insert({
        order_number: orderNumber,
        customer_id: useCustomer ? pick(customerIds) : null,
        guest_email: useCustomer ? null : `testorder${i}@example.com`,
        guest_phone: useCustomer ? null : `9${randomInt(100000000, 999999999)}`,
        subtotal,
        discount_amount: discountAmount,
        shipping_cost: shippingCost,
        gift_wrap_cost: 0,
        total,
        shipping_address: {
          firstName,
          lastName,
          addressLine1: `${randomInt(1, 200)} Test Layout`,
          city: loc.city,
          state: loc.state,
          pincode: loc.pincode,
          phone: `9${randomInt(100000000, 999999999)}`,
          email: `testorder${i}@example.com`,
        },
        shipping_method: "standard",
        payment_method: pick(PAYMENT_METHODS),
        payment_status: paymentStatus,
        status,
        placed_at: paymentStatus === "pending" ? null : placedAt.toISOString(),
        created_at: placedAt.toISOString(),
        updated_at: placedAt.toISOString(),
      })
      .select("id")
      .single();
    if (orderErr || !order) {
      console.warn(`  skip order ${orderNumber}: ${orderErr?.message}`);
      continue;
    }

    const orderItems = items.map((it) => ({
      order_id: order.id,
      product_id: it.product.id,
      product_name_snapshot: it.product.name,
      product_sku_snapshot: it.product.sku,
      unit_price_snapshot: it.product.price,
      quantity: it.qty,
      line_total: it.lineTotal,
    }));
    const { error: itemsErr } = await supabaseAdmin.from("order_items").insert(orderItems);
    if (itemsErr) {
      console.warn(`  order ${orderNumber} items failed: ${itemsErr.message}`);
      continue;
    }
    created++;
  }

  console.log(`  created ${created} orders.`);
  console.log("\nDone. All seeded data is tagged: order numbers start with 'TEST-', customer emails end with '@example.com'.");
  console.log("Run scripts/clean-dummy-analytics-data.ts to remove it before launch.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
