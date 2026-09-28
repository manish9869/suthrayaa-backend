import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, auth, seed, ADMIN_ID, STAFF_ID, CUSTOMER_A, PRODUCT_ID, SIZED_PRODUCT_ID } from "./helpers.js";
import { db } from "./db.js";
import { localDay, resolveRange, zonedMidnight } from "../modules/analytics/analytics.service.js";

const CATEGORY_ID = "99999999-0000-4000-8000-000000000001";
const range = "from=2026-03-01&to=2026-03-31";

/** An order row as checkout would leave it (defaults: paid online, one unit, Maharashtra). */
function order(over: Record<string, unknown> = {}, items: Record<string, unknown>[] = [{}]) {
  const id = randomUUID();
  const total = (over.total as number) ?? 500;
  db.table("orders").push({
    id,
    order_number: `ORD-${id.slice(0, 6)}`,
    customer_id: CUSTOMER_A,
    guest_email: null,
    shipping_address: { firstName: "Priya", lastName: "Sharma", state: "Maharashtra", email: "priya@example.com" },
    status: "confirmed",
    payment_status: "paid",
    payment_method: "razorpay",
    subtotal: total,
    discount_amount: 0,
    coupon_id: null,
    shipping_cost: 0,
    shipping_method: "standard",
    gift_wrap_cost: 0,
    total,
    tax_amount: 0,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    refunded_amount: 0,
    placed_at: "2026-03-10T06:00:00.000Z",
    created_at: "2026-03-10T05:59:00.000Z",
    ...over,
  });
  for (const item of items) {
    db.table("order_items").push({
      id: randomUUID(),
      order_id: id,
      product_id: PRODUCT_ID,
      product_name_snapshot: "Amigurumi Bunny",
      product_sku_snapshot: "SKU-1",
      quantity: 1,
      line_total: total,
      customizations: [],
      ...item,
    });
  }
  return id;
}

const report = (query = range, as = ADMIN_ID) => api().get(`/api/admin/analytics/reports?${query}`).set(auth(as));

beforeEach(() => {
  seed({ categories: [{ id: CATEGORY_ID, name: "Amigurumi", slug: "amigurumi", is_active: true }] });
  db.table("products").find((p) => p.id === PRODUCT_ID)!.category_id = CATEGORY_ID;
});

describe("store timezone", () => {
  it("buckets by the store's calendar day, not UTC", () => {
    // 20:00 UTC on the 9th is 01:30 on the 10th in India
    expect(localDay("2026-03-09T20:00:00.000Z", "Asia/Kolkata")).toBe("2026-03-10");
    expect(zonedMidnight("2026-03-10", "Asia/Kolkata").toISOString()).toBe("2026-03-09T18:30:00.000Z");
  });

  it("resolves whole local days and the matching previous period", async () => {
    const r = await resolveRange({ from: "2026-03-01", to: "2026-03-31" });
    expect(r).toMatchObject({ days: 31, since: "2026-02-28T18:30:00.000Z", until: "2026-03-31T18:29:59.999Z", prevFrom: "2026-01-29", prevTo: "2026-02-28" });
  });

  it("rejects malformed and oversized ranges", async () => {
    expect((await report("from=2026-03-31&to=2026-03-01")).status).toBe(400);
    expect((await report("from=yesterday&to=2026-03-01")).status).toBe(400);
    expect((await report("from=2000-01-01&to=2026-03-01")).status).toBe(400);
    expect((await report("days=-4")).status).toBe(400);
  });
});

describe("revenue definitions", () => {
  it("counts placed orders only, nets refunds, and COD once collected", async () => {
    order({ total: 1000, refunded_amount: 300, payment_status: "partially_refunded" });
    order({ total: 800, payment_method: "cod", payment_status: "paid", status: "delivered" });
    order({ total: 600, payment_method: "cod", payment_status: "pending", status: "shipped" }); // not collected yet
    order({ total: 400, payment_status: "pending", status: "pending_payment", placed_at: null }); // abandoned attempt
    order({ total: 200, status: "cancelled", payment_status: "pending", payment_method: "cod" });

    const res = await report();
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      placedOrders: 4,
      paidOrders: 2,
      grossSales: 1800,
      refunds: 300,
      netRevenue: 1500,
      avgOrderValue: 900,
      cancelledOrders: 1,
      cancellationRatePct: 25,
      codToCollectValue: 600,
    });
    expect(res.body.payments.attempts.total).toBe(5); // attempts include the abandoned one
  });

  it("puts a late-evening UTC order on the right local day", async () => {
    order({ placed_at: "2026-03-09T20:00:00.000Z" });
    const res = await report();
    const day = (d: string) => res.body.series.find((s: { date: string }) => s.date === d);
    expect(day("2026-03-10")).toMatchObject({ orders: 1, revenue: 500 });
    expect(day("2026-03-09").orders).toBe(0);
    expect(res.body.series).toHaveLength(31);
  });

  it("reads past the 1,000-row page size instead of truncating", async () => {
    for (let i = 0; i < 1203; i++) order({ total: 10 }, []);
    const res = await report();
    expect(res.body.summary).toMatchObject({ placedOrders: 1203, grossSales: 12030 });
  });

  it("compares against the previous period", async () => {
    order({ total: 1000 });
    order({ total: 500, placed_at: "2026-02-15T06:00:00.000Z" });
    const res = await report();
    expect(res.body.previous.netRevenue).toBe(500);
    expect(res.body.changes.netRevenue).toBe(100);
  });
});

describe("report sections", () => {
  it("breaks sales down by product, variant, category and customization", async () => {
    order({ total: 1300 }, [
      { quantity: 2, line_total: 1000, selected_color_name: "Pink" },
      {
        product_id: SIZED_PRODUCT_ID,
        product_name_snapshot: "Crochet Tote",
        line_total: 300,
        customizations: [{ label: "Size", type: "choice", valueLabel: "Large", priceAdjustment: 100 }],
      },
    ]);
    const { body } = await report();
    expect(body.products[0]).toMatchObject({ name: "Amigurumi Bunny", unitsSold: 2, revenue: 1000, orders: 1 });
    expect(body.variants.map((v: { variant: string }) => v.variant)).toEqual(["Pink", "Large"]);
    expect(body.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Amigurumi", revenue: 1000 }), expect.objectContaining({ name: "Uncategorized", revenue: 300 })])
    );
    expect(body.customization).toMatchObject({ items: 3, customized: 1, customizedRevenue: 300 });
    expect(body.customization.topOptions[0]).toMatchObject({ label: "Size", value: "Large", count: 1 });
  });

  it("summarises GST by place of supply and leaves fully refunded orders out", async () => {
    order({ total: 1180, tax_amount: 180, igst_amount: 180, shipping_address: { state: "Karnataka" } });
    order({ total: 1180, tax_amount: 180, cgst_amount: 90, sgst_amount: 90 });
    order({ total: 1180, tax_amount: 180, cgst_amount: 90, sgst_amount: 90, payment_status: "refunded", refunded_amount: 1180 });
    const { body } = await report();
    expect(body.tax).toHaveLength(2);
    expect(body.tax.find((t: { state: string }) => t.state === "Karnataka")).toMatchObject({ taxableValue: 1000, igst: 180, cgst: 0 });
    expect(body.tax.find((t: { state: string }) => t.state === "Maharashtra")).toMatchObject({ orders: 1, cgst: 90, sgst: 90 });
  });

  it("separates first-time from returning buyers", async () => {
    order({ placed_at: "2026-01-05T06:00:00.000Z" }); // CUSTOMER_A ordered before the period
    order();
    order({ customer_id: null, guest_email: "new@example.com" });
    const { body } = await report();
    expect(body.customers).toMatchObject({ buyers: 2, returningBuyers: 1, firstTimeBuyers: 1, guestOrders: 1, repeatRatePct: 50 });
  });

  it("reports refunds by the date they were issued", async () => {
    const id = order({ total: 1000, payment_status: "refunded", refunded_amount: 1000 });
    db.table("order_refunds").push({ id: randomUUID(), order_id: id, amount: 1000, method: "razorpay", status: "processed", reason: "Damaged", created_at: "2026-03-12T06:00:00.000Z" });
    db.table("order_refunds").push({ id: randomUUID(), order_id: id, amount: 50, method: "manual", status: "processed", reason: "Old", created_at: "2026-04-12T06:00:00.000Z" });
    const { body } = await report();
    expect(body.refunds).toMatchObject({ count: 1, amount: 1000 });
  });
});

describe("access and export", () => {
  it("requires analytics.view", async () => {
    expect((await report(range, STAFF_ID)).status).toBe(403);
    expect((await api().get(`/api/admin/analytics/reports?${range}`)).status).toBe(401);
    expect((await report(range, CUSTOMER_A)).status).toBe(403);
  });

  it("exports CSV with a BOM, neutralises spreadsheet formulas, and audits the export", async () => {
    order({ total: 500 }, [{ product_name_snapshot: '=HYPERLINK("http://evil","x")', line_total: 500 }]);
    const res = await api().get(`/api/admin/analytics/reports/export?section=products&${range}`).set(auth(ADMIN_ID));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toContain("product-sales-2026-03-01-to-2026-03-31.csv");
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(db.table("audit_logs").some((l) => l.action === "REPORT_EXPORTED")).toBe(true);
    expect((await api().get(`/api/admin/analytics/reports/export?section=nope&${range}`).set(auth(ADMIN_ID))).status).toBe(400);
  });

  it("requires analytics.export to export", async () => {
    const res = await api().get(`/api/admin/analytics/reports/export?section=products&${range}`).set(auth(STAFF_ID));
    expect(res.status).toBe(403);
  });
});

describe("dashboard endpoints", () => {
  it("summary counts placed orders and net revenue, with open orders to fulfil", async () => {
    order({ total: 1000 });
    order({ total: 400, payment_status: "pending", status: "pending_payment", placed_at: null });
    const res = await api().get(`/api/admin/analytics/summary?${range}`).set(auth(ADMIN_ID));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revenue: 1000, orderCount: 1, openOrders: 1, totalTransactions: 2, successfulTransactions: 1 });
  });
});
