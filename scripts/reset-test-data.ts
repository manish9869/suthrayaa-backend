/**
 * Wipes all transactional data and reseeds a realistic, clearly-marked test data set so every
 * admin screen (dashboard, analytics & reports, orders, refunds, customers, coupons, reviews,
 * newsletter, email logs) has something to show.
 *
 * KEEPS: admin users, roles & permissions, the catalog (products, images, categories, colours,
 * customizations) and all site configuration (settings, email templates, nav, footer,
 * homepage, shipping zones, tax categories).
 *
 * DELETES: orders (+ items, history, refunds, invoices, coupon redemptions), customers (every
 * auth user that isn't an admin, with their addresses, carts, wishlists), reviews, coupons,
 * newsletter subscribers, email logs, audit logs, analytics events.
 *
 * Seeded customers log in with   testcustomerN@example.com / Test@12345   (N = 1…24).
 * Seeded orders are numbered TEST-YYYY-NNNN and don't touch product stock.
 *
 * Usage: npx tsx scripts/reset-test-data.ts --yes
 */
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../src/config/supabase.js";
import { PRODUCT_SELECT, getEffectivePrice } from "../src/modules/catalog/serializers.js";
import { getShippingQuote } from "../src/modules/settings/shipping.service.js";
import { computeOrderGst } from "../src/modules/settings/tax.service.js";
import { getTaxCategories } from "../src/modules/settings/taxCategories.service.js";
import { getSetting } from "../src/modules/settings/settings.service.js";
import { createInvoiceForOrder } from "../src/modules/invoices/invoice.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

if (!process.argv.includes("--yes")) {
  console.error("This deletes every order, customer, review, coupon and log in the configured database.\nRe-run with --yes to confirm.");
  process.exit(1);
}

const PASSWORD = "Test@12345";
const CUSTOMER_COUNT = 24;
const ORDER_COUNT = 160;
const DAYS = 150;
const NIL = "00000000-0000-0000-0000-000000000000";

// Deterministic randomness, so re-running produces the same data set
let seed = 20260927;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[int(0, arr.length - 1)];
const chance = (p: number) => rand() < p;
const round2 = (n: number) => Math.round(n * 100) / 100;

const now = Date.now();
const DAY = 86_400_000;
/** A timestamp `days` ago during Indian daytime (09:00–21:59 IST). */
function daysAgo(days: number) {
  const d = new Date(now - days * DAY);
  d.setUTCHours(int(3, 16), int(0, 59), int(0, 59), 0);
  return d.getTime() > now ? new Date(now - int(1, 120) * 60_000) : d;
}
const after = (d: Date, hoursMin: number, hoursMax: number) => {
  const t = new Date(d.getTime() + int(hoursMin * 60, hoursMax * 60) * 60_000);
  return t.getTime() > now ? new Date(now - 60_000) : t;
};

const FIRST = ["Aarav", "Priya", "Rohan", "Ananya", "Vihaan", "Ishita", "Kabir", "Meera", "Aditya", "Sara", "Arjun", "Diya", "Kunal", "Neha", "Rahul", "Pooja", "Siddharth", "Kavya", "Nikhil", "Tanvi", "Yash", "Riya", "Omkar", "Sneha"];
const LAST = ["Sharma", "Verma", "Iyer", "Nair", "Reddy", "Gupta", "Kapoor", "Joshi", "Chauhan", "Mehta", "Kulkarni", "Deshpande", "Banerjee", "Pillai"];
const PLACES = [
  { city: "Pune", district: "Pune", state: "Maharashtra", pincode: "411001" },
  { city: "Mumbai", district: "Mumbai", state: "Maharashtra", pincode: "400050" },
  { city: "Nagpur", district: "Nagpur", state: "Maharashtra", pincode: "440010" },
  { city: "Bengaluru", district: "Bengaluru Urban", state: "Karnataka", pincode: "560034" },
  { city: "Hyderabad", district: "Hyderabad", state: "Telangana", pincode: "500081" },
  { city: "Chennai", district: "Chennai", state: "Tamil Nadu", pincode: "600040" },
  { city: "New Delhi", district: "New Delhi", state: "Delhi", pincode: "110017" },
  { city: "Ahmedabad", district: "Ahmedabad", state: "Gujarat", pincode: "380015" },
  { city: "Kolkata", district: "Kolkata", state: "West Bengal", pincode: "700019" },
  { city: "Jaipur", district: "Jaipur", state: "Rajasthan", pincode: "302017" },
  { city: "Kochi", district: "Ernakulam", state: "Kerala", pincode: "682020" },
  { city: "Lucknow", district: "Lucknow", state: "Uttar Pradesh", pincode: "226010" },
];
const STREETS = ["MG Road", "Linking Road", "FC Road", "Indiranagar 100 Ft Rd", "Banjara Hills Rd 12", "Anna Salai", "Hauz Khas", "CG Road", "Park Street", "MI Road", "Marine Drive", "Hazratganj"];
const COURIERS = ["Delhivery", "Blue Dart", "DTDC", "India Post", "Xpressbees"];
const CUSTOM_TEXTS = ["Aanya", "Happy Birthday", "Love, Ma", "Kabir", "Best Friends", "Riya ♥", "Team 2026", "Dadi"];
const REVIEW_TEXTS: [number, string, string][] = [
  [5, "Absolutely adorable", "The stitching is so neat and the colours are exactly as shown. My daughter hasn't put it down!"],
  [5, "Perfect gift", "Ordered with a name on it for my niece — beautifully done and arrived well packed."],
  [4, "Lovely, slightly smaller", "Really cute and soft. A bit smaller than I imagined but still great value."],
  [5, "Worth the wait", "Made to order took a week but the quality shows. Will order again."],
  [4, "Nice quality", "Good yarn and finish. Delivery was a day late but the team kept me updated."],
  [3, "Okay", "Nice product but the colour was a shade lighter than the photo."],
  [2, "Loose thread", "One loose thread near the base. Support offered a replacement though."],
  [5, "Handmade with love", "You can tell each piece is made by hand. Beautiful work!"],
];

// ---------------------------------------------------------------- wipe

async function wipe() {
  const { data: admins, error } = await supabaseAdmin.from("admin_users").select("id");
  if (error) throw error;
  const adminIds = new Set((admins ?? []).map((a) => a.id));
  if (adminIds.size === 0) throw new Error("No admin users found — refusing to wipe (you'd lock yourself out).");

  const tables = [
    "order_refunds",
    "coupon_redemptions",
    "invoices",
    "email_logs",
    "order_status_history",
    "order_items",
    "orders",
    "cart_items",
    "wishlist_items",
    "addresses",
    "reviews",
    "coupons",
    "newsletter_subscribers",
    "audit_logs",
    "analytics_events",
  ];
  for (const t of tables) {
    const { error: delErr, count } = await supabaseAdmin.from(t).delete({ count: "exact" }).neq("id", NIL);
    if (delErr) throw new Error(`Wiping ${t}: ${delErr.message}`);
    console.log(`  cleared ${t.padEnd(24)} ${count ?? 0}`);
  }

  let removed = 0;
  for (let page = 1; ; page++) {
    const { data, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) throw listErr;
    const users = data.users.filter((u) => !adminIds.has(u.id));
    for (const u of users) {
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
      if (delErr) console.warn(`  could not delete ${u.email}: ${delErr.message}`);
      else removed++;
    }
    if (data.users.length < 200) break;
    if (users.length > 0) page--; // deletions shift later users onto this page
  }
  console.log(`  removed ${removed} customer accounts (profiles cascade)`);
  // Profiles whose auth user is already gone
  await supabaseAdmin.from("customer_profiles").delete().not("id", "in", `(${[...adminIds].join(",")})`);
}

// ---------------------------------------------------------------- seed

interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  place: (typeof PLACES)[number];
  joinedAt: Date;
}

function address(c: { firstName: string; lastName: string; phone: string; email: string; place: (typeof PLACES)[number] }, i = 0) {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    email: c.email,
    addressLine1: `${int(1, 220)}, ${pick(["Lotus", "Silver Oak", "Green Park", "Sai Krupa", "Shanti Niketan"])} Apartments`,
    addressLine2: STREETS[(PLACES.indexOf(c.place) + i) % STREETS.length],
    landmark: chance(0.5) ? pick(["Near City Mall", "Opp. Post Office", "Behind Temple", "Next to Metro"]) : undefined,
    city: c.place.city,
    district: c.place.district,
    state: c.place.state,
    pincode: c.place.pincode,
  };
}

async function seedCustomers(): Promise<Customer[]> {
  const customers: Customer[] = [];
  for (let i = 1; i <= CUSTOMER_COUNT; i++) {
    const firstName = FIRST[(i - 1) % FIRST.length];
    const lastName = pick(LAST);
    const email = `testcustomer${i}@example.com`;
    const phone = `9${String(800000000 + i * 7919).padStart(9, "0")}`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (error) throw new Error(`Creating ${email}: ${error.message}`);
    const joinedAt = daysAgo(int(0, DAYS + 30));
    const place = pick(PLACES);
    await supabaseAdmin
      .from("customer_profiles")
      .upsert({ id: data.user.id, email, phone, first_name: firstName, last_name: lastName, marketing_opt_in: chance(0.5), created_at: joinedAt.toISOString() });
    customers.push({ id: data.user.id, email, firstName, lastName, phone, place, joinedAt });

    // Address book: a default address, and for some a second (work / parents') address
    const rows: any[] = [{ ...addrRow(customers[i - 1], 0), label: "Home", address_type: "home", is_default: true, is_default_billing: true }];
    if (chance(0.4)) {
      const other = { ...customers[i - 1], place: pick(PLACES) };
      rows.push({ ...addrRow(other, 1), label: pick(["Work", "Parents"]), address_type: pick(["work", "other"]), is_default: false, is_default_billing: false });
    }
    const { error: addrErr } = await supabaseAdmin.from("addresses").insert(rows.map((r) => ({ ...r, customer_id: data.user.id })));
    if (addrErr) throw new Error(`Addresses: ${addrErr.message}`);
  }
  return customers;
}

function addrRow(c: Customer, i: number) {
  const a = address(c, i);
  return {
    first_name: a.firstName,
    last_name: a.lastName,
    phone: a.phone,
    address_line1: a.addressLine1,
    address_line2: a.addressLine2,
    landmark: a.landmark ?? null,
    city: a.city,
    district: a.district,
    state: a.state,
    pincode: a.pincode,
  };
}

async function seedCoupons() {
  const in30 = new Date(now + 30 * DAY).toISOString();
  const rows = [
    { code: "WELCOME10", type: "percent", value: 10, min_subtotal: 0, max_uses_per_customer: 1, is_active: true },
    { code: "FLAT100", type: "flat", value: 100, min_subtotal: 999, is_active: true },
    { code: "FESTIVE20", type: "percent", value: 20, min_subtotal: 1499, max_uses: 60, starts_at: new Date(now - 45 * DAY).toISOString(), expires_at: in30, is_active: true },
    { code: "MONSOON15", type: "percent", value: 15, min_subtotal: 0, expires_at: new Date(now - 20 * DAY).toISOString(), is_active: true },
    { code: "STAFF50", type: "percent", value: 50, min_subtotal: 0, max_uses: 5, is_active: false },
  ];
  const { data, error } = await supabaseAdmin.from("coupons").insert(rows.map((r) => ({ uses_count: 0, ...r }))).select("*");
  if (error) throw new Error(`Coupons: ${error.message}`);
  return data!;
}

/** Picks options for every enabled customization group the way a shopper would. */
function chooseCustomizations(product: any) {
  const groups = (product.product_customizations ?? []).filter((g: any) => g.enabled);
  const snapshot: any[] = [];
  let adjustment = 0;
  const chosenValueIds = new Set<string>();
  for (const g of groups.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    if (g.conditional_parent_value_id && !chosenValueIds.has(g.conditional_parent_value_id)) continue;
    if (!g.required && chance(0.45)) continue;
    if (g.type === "text" || g.type === "number") {
      const text = g.type === "number" ? String(int(1, 30)) : pick(CUSTOM_TEXTS).slice(0, g.max_length ?? 40);
      snapshot.push({ customizationId: g.id, name: g.name, label: g.label, type: g.type, textValue: text, priceAdjustment: 0 });
      continue;
    }
    const values = (g.customization_values ?? []).filter((v: any) => v.enabled);
    if (values.length === 0) continue;
    const v = pick(values) as any;
    chosenValueIds.add(v.id);
    adjustment += Number(v.price_adjustment ?? 0);
    snapshot.push({ customizationId: g.id, name: g.name, label: g.label, type: g.type, valueId: v.id, valueLabel: v.label, value: v.value, priceAdjustment: Number(v.price_adjustment ?? 0) });
  }
  return { snapshot, adjustment };
}

type Scenario =
  | "delivered"
  | "shipped"
  | "ready"
  | "making"
  | "confirmed"
  | "cancelled_unpaid"
  | "cancelled_refunded"
  | "cancelled_refund_due"
  | "partial_refund"
  | "returned_refunded"
  | "payment_failed"
  | "abandoned";

function scenarioFor(ageDays: number, method: "cod" | "razorpay"): Scenario {
  const r = rand();
  if (method === "razorpay") {
    if (r < 0.06) return "payment_failed";
    if (r < 0.1) return "abandoned";
    if (r < 0.13) return "cancelled_refunded";
    if (ageDays < 20 && r < 0.145) return "cancelled_refund_due";
    if (ageDays > 12 && r < 0.18) return "partial_refund";
    if (ageDays > 12 && r < 0.2) return "returned_refunded";
  } else if (r < 0.08) {
    return "cancelled_unpaid";
  }
  // Fulfilment progresses with age
  if (ageDays > 12) return "delivered";
  if (ageDays > 7) return chance(0.7) ? "delivered" : "shipped";
  if (ageDays > 4) return pick(["shipped", "ready", "delivered"] as const);
  if (ageDays > 1) return pick(["making", "ready", "confirmed"] as const);
  return pick(["confirmed", "making"] as const);
}

const PATH: Record<string, string[]> = {
  confirmed: ["confirmed"],
  making: ["confirmed", "in_production"],
  ready: ["confirmed", "in_production", "ready"],
  shipped: ["confirmed", "in_production", "ready", "shipped"],
  delivered: ["confirmed", "in_production", "ready", "shipped", "delivered"],
};
const STATUS_NOTES: Record<string, string> = {
  confirmed: "Payment verified via Razorpay",
  in_production: "Started making",
  ready: "Packed and ready to ship",
  shipped: "Handed to courier",
  delivered: "Delivered to customer",
};

async function seedOrders(customers: Customer[], products: any[], coupons: any[], adminId: string) {
  const [gstEnabled, pricesIncludeGst, sellerState, defaultTaxCategoryId, giftWrapFee, categories] = await Promise.all([
    getSetting<boolean>("tax.gst_enabled"),
    getSetting<boolean>("tax.prices_include_gst"),
    getSetting<string>("business.gst_state"),
    getSetting<string>("tax.default_tax_category_id"),
    getSetting<number>("shipping.gift_wrap_fee"),
    getTaxCategories(),
  ]);
  const year = new Date().getFullYear();
  const couponUses = new Map<string, number>();
  const guestPool = Array.from({ length: 10 }, (_, i) => ({
    firstName: pick(FIRST),
    lastName: pick(LAST),
    email: `guest${i + 1}@example.com`,
    phone: `8${String(700000000 + i * 104729).padStart(9, "0")}`,
    place: pick(PLACES),
  }));
  const counts: Record<string, number> = {};
  const collectedOrderIds: string[] = [];

  // Denser recently, sparser in the past — like a growing shop
  const ages = Array.from({ length: ORDER_COUNT }, () => Math.floor(Math.pow(rand(), 1.6) * DAYS)).sort((a, b) => b - a);

  for (let n = 0; n < ages.length; n++) {
    const age = ages[n];
    const customer = chance(0.8) ? pick(customers.filter((c) => c.joinedAt.getTime() <= now - age * DAY) as Customer[]) ?? null : null;
    const guest = customer ? null : pick(guestPool);
    const who = (customer ?? guest)!;
    const shippingAddress = address({ ...who, email: who.email }, 0);
    const method: "cod" | "razorpay" = chance(0.62) ? "razorpay" : "cod";
    const scenario = scenarioFor(age, method);
    const createdAt = daysAgo(age);

    // Lines
    const lines: any[] = [];
    const lineCount = pick([1, 1, 1, 2, 2, 3]);
    for (let l = 0; l < lineCount; l++) {
      const p = pick(products);
      const colors = (p.product_colors ?? []).map((pc: any) => pc.colors).filter(Boolean);
      const color: any = colors.length && chance(0.7) ? pick(colors) : null;
      const { snapshot, adjustment } = chooseCustomizations(p);
      const unit = round2(getEffectivePrice(p) + adjustment);
      const qty = pick([1, 1, 1, 2, 2, 3]);
      const image = (p.product_images ?? []).slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.url ?? null;
      lines.push({
        product: p,
        row: {
          product_id: p.id,
          product_name_snapshot: p.name,
          product_sku_snapshot: p.sku ?? null,
          product_image_snapshot: image,
          unit_price_snapshot: unit,
          selected_color_hex: color?.hex ?? null,
          selected_color_name: color?.name ?? null,
          custom_text: null,
          customizations: snapshot,
          quantity: qty,
          line_total: round2(unit * qty),
        },
      });
    }
    const subtotal = round2(lines.reduce((s, l) => s + l.row.line_total, 0));

    // Coupon — only ones that were valid at the time
    let coupon: any = null;
    let discount = 0;
    if (chance(0.28)) {
      const at = createdAt.getTime();
      const usable = coupons.filter(
        (c) =>
          c.is_active &&
          subtotal >= Number(c.min_subtotal) &&
          (!c.starts_at || Date.parse(c.starts_at) <= at) &&
          (!c.expires_at || Date.parse(c.expires_at) >= at) &&
          (c.max_uses == null || (couponUses.get(c.id) ?? 0) < c.max_uses) &&
          !(c.code === "WELCOME10" && customer && [...couponUses.keys()].includes(`WELCOME10:${customer.id}`))
      );
      if (usable.length) {
        coupon = pick(usable);
        discount = coupon.type === "percent" ? round2((subtotal * Number(coupon.value)) / 100) : Math.min(Number(coupon.value), subtotal);
      }
    }

    const netSubtotal = subtotal - discount;
    const shippingMethod: "standard" | "express" = chance(0.15) ? "express" : "standard";
    const quote = await getShippingQuote(shippingAddress.state, netSubtotal, shippingMethod);
    const giftWrap = chance(0.12);
    const giftWrapCost = giftWrap ? Number(giftWrapFee ?? 0) : 0;
    let total = round2(netSubtotal + quote.fee + giftWrapCost);
    let tax = { totalTax: 0, cgst: 0, sgst: 0, igst: 0 };
    if (gstEnabled && sellerState) {
      const fallback = categories.get(defaultTaxCategoryId);
      const gst = computeOrderGst({
        lines: lines.map((l) => {
          const cat = categories.get(l.product.tax_category_id ?? "") ?? fallback;
          return { amount: l.row.line_total, ratePercent: cat?.rate ?? 0, hsn: cat?.hsn ?? null };
        }),
        discount,
        charges: [
          { label: "Shipping", amount: quote.fee },
          { label: "Gift wrap", amount: giftWrapCost },
        ],
        sellerState,
        buyerState: shippingAddress.state,
        pricesIncludeGst,
      });
      tax = { totalTax: gst.totalTax, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst };
      if (!pricesIncludeGst) total = gst.grandTotal;
    }

    // Lifecycle
    const unpaidAttempt = scenario === "payment_failed" || scenario === "abandoned";
    const paidOnline = method === "razorpay" && !unpaidAttempt;
    const placedAt = unpaidAttempt ? null : after(createdAt, 0, 0.2);
    const history: { status: string; note: string | null; at: Date; admin?: boolean }[] = [];
    let status = "confirmed";
    let paymentStatus = "pending";
    let paidAt: Date | null = null;
    let refunded = 0;
    const refunds: any[] = [];
    let tracking: string | null = null;
    let courier: string | null = null;

    if (unpaidAttempt) {
      status = "pending_payment";
      paymentStatus = scenario === "payment_failed" ? "failed" : "pending";
      history.push({ status: "pending_payment", note: "Order created, awaiting payment", at: createdAt });
      if (scenario === "payment_failed") history.push({ status: "pending_payment", note: "Payment failed", at: after(createdAt, 0, 0.1) });
    } else {
      if (method === "cod") history.push({ status: "confirmed", note: "Order placed (Cash on Delivery)", at: placedAt! });
      else {
        history.push({ status: "pending_payment", note: "Order created, awaiting payment", at: createdAt });
        paymentStatus = "paid";
        paidAt = placedAt;
      }

      const fulfil = (target: string) => {
        let t = placedAt!;
        for (const s of PATH[target]) {
          if (s === "confirmed") {
            if (method === "razorpay") history.push({ status: "confirmed", note: STATUS_NOTES.confirmed, at: t });
            continue;
          }
          t = after(t, s === "delivered" ? 36 : 10, s === "delivered" ? 110 : 40);
          history.push({ status: s, note: s === "delivered" && method === "cod" ? "Cash on Delivery collected" : STATUS_NOTES[s], at: t, admin: true });
          if (s === "shipped") {
            courier = pick(COURIERS);
            tracking = `${courier.slice(0, 3).toUpperCase()}${int(10000000, 99999999)}`;
          }
          if (s === "delivered" && method === "cod") {
            paymentStatus = "paid";
            paidAt = t;
          }
        }
        status = PATH[target].at(-1)!;
        return t;
      };

      if (scenario.startsWith("cancelled")) {
        if (method === "razorpay") history.push({ status: "confirmed", note: STATUS_NOTES.confirmed, at: placedAt! });
        const cancelAt = after(placedAt!, 1, 20);
        const byCustomer = chance(0.6);
        status = "cancelled";
        history.push({
          status: "cancelled",
          note: byCustomer ? `Cancelled by customer: ${pick(["Ordered by mistake", "Found a different design", "Needed it sooner"])}` : "Cancelled — out of yarn in the chosen colour",
          at: cancelAt,
          admin: !byCustomer,
        });
        if (scenario === "cancelled_refunded") {
          refunded = total;
          paymentStatus = "refunded";
          status = "refunded";
          const at = after(cancelAt, 2, 30);
          refunds.push({ amount: total, reason: "Order cancelled before making", restocked: true, at });
          history.push({ status: "refunded", note: `Refunded ₹${total} via Razorpay — Order cancelled before making · stock returned`, at, admin: true });
        }
      } else if (scenario === "partial_refund") {
        const doneAt = fulfil("delivered");
        const amount = round2(Math.min(total - 1, Math.max(50, lines[0].row.unit_price_snapshot * 0.3)));
        refunded = amount;
        paymentStatus = "partially_refunded";
        const at = after(doneAt, 24, 96);
        refunds.push({ amount, reason: pick(["Small defect — goodwill refund", "Delivered late", "Colour slightly off"]), restocked: false, at });
        history.push({ status: "delivered", note: `Partially refunded ₹${amount} via Razorpay`, at, admin: true });
      } else if (scenario === "returned_refunded") {
        const doneAt = fulfil("delivered");
        refunded = total;
        paymentStatus = "refunded";
        status = "refunded";
        const at = after(doneAt, 72, 200);
        refunds.push({ amount: total, reason: "Returned — wrong size", restocked: false, at });
        history.push({ status: "refunded", note: `Refunded ₹${total} via Razorpay — Returned — wrong size`, at, admin: true });
      } else {
        fulfil(scenario === "making" ? "making" : scenario);
      }
    }

    const collected = ["paid", "partially_refunded", "refunded"].includes(paymentStatus);
    const orderId = randomUUID();
    const lastAt = history.reduce((m, h) => (h.at > m ? h.at : m), createdAt);
    const order = {
      id: orderId,
      order_number: `TEST-${year}-${String(n + 1).padStart(4, "0")}`,
      customer_id: customer?.id ?? null,
      guest_email: guest ? guest.email : null,
      guest_phone: guest ? guest.phone : null,
      subtotal,
      discount_amount: discount,
      coupon_id: coupon?.id ?? null,
      shipping_cost: quote.fee,
      gift_wrap_cost: giftWrapCost,
      gift_wrap: giftWrap,
      gift_message: giftWrap ? pick(["Happy birthday! 🎂", "With love", "Congratulations!"]) : null,
      total,
      tax_amount: tax.totalTax,
      cgst_amount: tax.cgst,
      sgst_amount: tax.sgst,
      igst_amount: tax.igst,
      shipping_address: shippingAddress,
      billing_address: chance(0.1) ? address({ ...who, place: pick(PLACES) }, 1) : null,
      shipping_method: shippingMethod,
      payment_method: method,
      payment_status: paymentStatus,
      razorpay_order_id: method === "razorpay" ? `order_TEST${orderId.slice(0, 12)}` : null,
      razorpay_payment_id: paidOnline ? `pay_TEST${orderId.slice(0, 12)}` : null,
      status,
      tracking_number: tracking,
      courier,
      admin_notes: chance(0.08) ? pick(["Customer asked for extra bubble wrap", "VIP — include a thank-you card", "Called to confirm the name spelling"]) : null,
      customer_notes: chance(0.1) ? pick(["Please deliver after 6pm", "Gift — no invoice in the box please", "Call before delivery"]) : null,
      placed_at: placedAt?.toISOString() ?? null,
      paid_at: collected ? paidAt?.toISOString() ?? placedAt?.toISOString() : null,
      refunded_amount: refunded,
      // Seeded orders never touched real stock, so cancelling/refunding them must not add any
      stock_committed: false,
      is_custom: lines.some((l) => l.row.customizations.length > 0 || Boolean(l.row.custom_text)),
      created_at: createdAt.toISOString(),
      updated_at: lastAt.toISOString(),
    };
    const { error: oErr } = await supabaseAdmin.from("orders").insert(order);
    if (oErr) throw new Error(`Order ${order.order_number}: ${oErr.message}`);
    const { error: iErr } = await supabaseAdmin.from("order_items").insert(lines.map((l) => ({ ...l.row, order_id: orderId })));
    if (iErr) throw new Error(`Items ${order.order_number}: ${iErr.message}`);
    await supabaseAdmin.from("order_status_history").insert(
      history.map((h) => ({ order_id: orderId, status: h.status, note: h.note, changed_by: h.admin ? adminId : null, created_at: h.at.toISOString() }))
    );
    if (refunds.length) {
      await supabaseAdmin.from("order_refunds").insert(
        refunds.map((r) => ({
          order_id: orderId,
          amount: r.amount,
          method: "razorpay",
          razorpay_refund_id: `rfnd_TEST${randomUUID().slice(0, 12)}`,
          status: "processed",
          reason: r.reason,
          restocked: r.restocked,
          created_by: adminId,
          created_at: r.at.toISOString(),
        }))
      );
    }
    if (coupon && collected) {
      couponUses.set(coupon.id, (couponUses.get(coupon.id) ?? 0) + 1);
      if (customer) couponUses.set(`${coupon.code}:${customer.id}`, 1);
      await supabaseAdmin.from("coupon_redemptions").insert({
        coupon_id: coupon.id,
        order_id: orderId,
        customer_id: customer?.id ?? null,
        customer_email: (customer?.email ?? guest?.email ?? "").toLowerCase() || null,
        amount_discounted: discount,
        created_at: (placedAt ?? createdAt).toISOString(),
      });
    }
    if (collected || (method === "cod" && placedAt)) collectedOrderIds.push(orderId);
    counts[scenario] = (counts[scenario] ?? 0) + 1;
  }

  for (const [id, uses] of couponUses) if (!id.includes(":")) await supabaseAdmin.from("coupons").update({ uses_count: uses }).eq("id", id);
  console.log(`  orders by scenario: ${JSON.stringify(counts)}`);
  return collectedOrderIds;
}

async function seedInvoices(orderIds: string[]) {
  let made = 0;
  for (const id of orderIds) {
    try {
      const inv = await createInvoiceForOrder(id);
      const { data: o } = await supabaseAdmin.from("orders").select("placed_at").eq("id", id).single();
      if (o?.placed_at) await supabaseAdmin.from("invoices").update({ created_at: o.placed_at }).eq("id", inv.id);
      made++;
    } catch (err) {
      console.warn(`  invoice for ${id} skipped: ${(err as Error).message}`);
    }
  }
  console.log(`  invoices: ${made}`);
}

async function seedCustomerActivity(customers: Customer[], products: any[]) {
  // Reviews from buyers — a mix of published and awaiting moderation
  const { data: bought } = await supabaseAdmin
    .from("order_items")
    .select("product_id, orders!inner(customer_id, status)")
    .not("product_id", "is", null);
  const pairs = new Map<string, { productId: string; customerId: string }>();
  for (const b of (bought ?? []) as any[]) {
    if (b.orders?.customer_id && b.orders.status === "delivered") pairs.set(`${b.product_id}:${b.orders.customer_id}`, { productId: b.product_id, customerId: b.orders.customer_id });
  }
  const reviewRows = [...pairs.values()].slice(0, 26).map((p, i) => {
    const [rating, title, content] = REVIEW_TEXTS[i % REVIEW_TEXTS.length];
    const c = customers.find((x) => x.id === p.customerId)!;
    return {
      product_id: p.productId,
      customer_id: p.customerId,
      customer_name: `${c.firstName} ${c.lastName.charAt(0)}.`,
      rating,
      title,
      content,
      is_verified_purchase: true,
      is_published: i % 4 !== 0, // every 4th waits in the moderation queue
      created_at: daysAgo(int(0, 60)).toISOString(),
    };
  });
  if (reviewRows.length) {
    const { error } = await supabaseAdmin.from("reviews").insert(reviewRows);
    if (error) throw new Error(`Reviews: ${error.message}`);
  }

  // Wishlists and carts that are "in progress"
  const wish: any[] = [];
  const cart: any[] = [];
  for (const c of customers) {
    if (chance(0.55)) {
      const picks = new Set<string>();
      for (let i = 0; i < int(1, 4); i++) picks.add(pick(products).id);
      for (const pid of picks) wish.push({ customer_id: c.id, product_id: pid });
    }
    if (chance(0.3)) cart.push({ customer_id: c.id, product_id: pick(products).id, quantity: int(1, 2), customizations: [] });
  }
  if (wish.length) await supabaseAdmin.from("wishlist_items").insert(wish);
  if (cart.length) await supabaseAdmin.from("cart_items").insert(cart);

  // Newsletter: most customers who opted in, some guests, a few unsubscribes
  const subs = [
    ...customers.filter(() => chance(0.45)).map((c) => ({ email: c.email, source: "account", status: "subscribed" })),
    ...Array.from({ length: 8 }, (_, i) => ({ email: `reader${i + 1}@example.com`, source: pick(["footer", "popup"]), status: i < 2 ? "unsubscribed" : "subscribed" })),
  ].map((s) => ({ ...s, created_at: daysAgo(int(0, DAYS)).toISOString() }));
  await supabaseAdmin.from("newsletter_subscribers").insert(subs);
  console.log(`  reviews: ${reviewRows.length} · wishlist items: ${wish.length} · carts: ${cart.length} · subscribers: ${subs.length}`);
}

async function seedEmailLogs() {
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, status, guest_email, shipping_address, placed_at")
    .not("placed_at", "is", null)
    .order("placed_at", { ascending: false })
    .limit(40);
  const rows: any[] = [];
  for (const o of (orders ?? []) as any[]) {
    const to = o.guest_email ?? o.shipping_address?.email;
    if (!to) continue;
    rows.push({ type: "order_placed", recipient: to, order_id: o.id, subject: `Order ${o.order_number} received`, status: "sent", sent_at: o.placed_at });
    if (["shipped", "delivered"].includes(o.status)) {
      const failed = chance(0.1);
      rows.push({
        type: "order_shipped",
        recipient: to,
        order_id: o.id,
        subject: `Your order ${o.order_number} is on its way`,
        status: failed ? "failed" : "sent",
        error_message: failed ? "SMTP 421: Service not available, try again later" : null,
        sent_at: new Date(Date.parse(o.placed_at) + 3 * DAY).toISOString(),
      });
    }
  }
  if (rows.length) await supabaseAdmin.from("email_logs").insert(rows);
  console.log(`  email logs: ${rows.length}`);
}

async function main() {
  const { data: admin } = await supabaseAdmin.from("admin_users").select("id").limit(1).single();
  if (!admin) throw new Error("No admin user found.");

  console.log("Wiping transactional data (admins, catalog and settings are kept)…");
  await wipe();

  const { data: products, error } = await supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("is_active", true);
  if (error) throw error;
  if (!products?.length) throw new Error("No active products — seed the catalog first (npm run seed:catalog).");

  console.log("Seeding customers…");
  const customers = await seedCustomers();
  console.log(`  customers: ${customers.length}`);
  console.log("Seeding coupons…");
  const coupons = await seedCoupons();
  console.log("Seeding orders…");
  const invoiceable = await seedOrders(customers, products, coupons, admin.id);
  console.log("Generating invoices…");
  await seedInvoices(invoiceable);
  console.log("Seeding reviews, wishlists, carts, newsletter…");
  await seedCustomerActivity(customers, products);
  console.log("Seeding email logs…");
  await seedEmailLogs();

  console.log(`\nDone. Customer logins: testcustomer1…${CUSTOMER_COUNT}@example.com / ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
