import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, auth, seed, placeCodOrder, ADMIN_ID, STAFF_ID, CUSTOMER_A, CUSTOMER_B, SIZED_PRODUCT_ID, SIZE_GROUP_ID, SIZE_LARGE_ID } from "./helpers.js";
import { db } from "./db.js";

beforeEach(() => seed());

function order(over: Record<string, unknown> = {}) {
  const id = randomUUID();
  db.table("orders").push({
    id,
    order_number: `ORD-2026-${String(db.table("orders").length + 1).padStart(4, "0")}`,
    customer_id: null,
    guest_email: null,
    shipping_address: { firstName: "Priya", lastName: "Sharma", email: "priya@example.com", phone: "9876543210", state: "Maharashtra" },
    status: "confirmed",
    payment_status: "paid",
    payment_method: "razorpay",
    total: 500,
    refunded_amount: 0,
    is_custom: false,
    placed_at: "2026-03-10T06:00:00.000Z",
    created_at: "2026-03-10T06:00:00.000Z",
    ...over,
  });
  return id;
}

const list = (query: string, as = ADMIN_ID) => api().get(`/api/admin/orders?${query}`).set(auth(as));

describe("admin orders list", () => {
  it("pages past the old 300-order cap, with totals over the whole filtered set", async () => {
    for (let i = 0; i < 340; i++) order({ total: 100, created_at: new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString() });
    const res = await list("page=17&limit=20");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(340);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.stats).toMatchObject({ revenue: 34000, paid: 340 });
    const last = await list("page=18&limit=20");
    expect(last.body.items).toHaveLength(0);
  });

  it("searches order number, customer name, email and phone — every word must match", async () => {
    order({ order_number: "ORD-2026-7777" });
    order({ shipping_address: { firstName: "Kabir", lastName: "Nair", email: "kabir@example.com", phone: "9123456780" } });
    order({ shipping_address: { firstName: "Kabir", lastName: "Mehta", email: "km@example.com", phone: "9000000000" } });
    const ids = async (q: string) => (await list(`q=${encodeURIComponent(q)}`)).body.items.map((o: { orderNumber: string; customerName: string }) => o.customerName ?? o.orderNumber);
    expect(await ids("7777")).toEqual(["Priya Sharma"]);
    expect(await ids("kabir")).toHaveLength(2);
    expect(await ids("Kabir Nair")).toEqual(["Kabir Nair"]);
    expect(await ids("912345")).toEqual(["Kabir Nair"]);
    expect(await ids("km@example")).toEqual(["Kabir Mehta"]);
  });

  it("neutralises PostgREST filter syntax in the search box", async () => {
    order();
    const res = await list(`q=${encodeURIComponent("x),status.eq.cancelled,(y")}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("filters by status, payment, custom orders, total and date, and sorts", async () => {
    order({ total: 900, is_custom: true });
    order({ total: 300, payment_status: "pending", payment_method: "cod" });
    order({ total: 1500, status: "cancelled", created_at: "2026-02-01T06:00:00.000Z" });
    expect((await list("custom=true")).body.items.map((o: { total: number }) => o.total)).toEqual([900]);
    expect((await list("paymentMethod=cod")).body.total).toBe(1);
    expect((await list("minTotal=500&maxTotal=1000")).body.total).toBe(1);
    expect((await list("from=2026-03-01&to=2026-03-31")).body.total).toBe(2);
    expect((await list("sort=total&dir=asc")).body.items.map((o: { total: number }) => o.total)).toEqual([300, 900, 1500]);
    const stats = (await list("")).body.stats;
    expect(stats).toMatchObject({ pendingPayment: 1, cancelledOrRefunded: 1, maxTotal: 1500 });
    expect((await list("status=nope")).status).toBe(400);
  });

  it("marks orders with personalization as custom at checkout", async () => {
    const res = await placeCodOrder(CUSTOMER_A, [{ productId: SIZED_PRODUCT_ID, quantity: 1, customizations: [{ customizationId: SIZE_GROUP_ID, valueId: SIZE_LARGE_ID }] }] as never);
    expect(res.status).toBe(201);
    expect(db.table("orders")[0].is_custom).toBe(true);
  });

  it("exports the filtered set as CSV only with orders.export, and audits it", async () => {
    order({ shipping_address: { firstName: "=cmd|' /C calc'!A0", lastName: "X", email: "x@example.com" } });
    order({ status: "cancelled" });
    const res = await api().get("/api/admin/orders/export?status=confirmed").set(auth(ADMIN_ID));
    expect(res.status).toBe(200);
    expect(res.text.split("\r\n")).toHaveLength(2);
    expect(res.text).toContain("'=cmd");
    expect(db.table("audit_logs").some((l) => l.action === "DATA_EXPORTED" && l.resource === "orders")).toBe(true);
    expect((await api().get("/api/admin/orders/export").set(auth(STAFF_ID))).status).toBe(403);
  });
});

describe("admin customers list", () => {
  beforeEach(() => {
    db.table("customer_profiles").push(
      { id: CUSTOMER_A, email: "priya@example.com", phone: "9876543210", first_name: "Priya", last_name: "Sharma", created_at: "2026-01-05T06:00:00.000Z" },
      { id: CUSTOMER_B, email: "kabir@example.com", phone: "9123456780", first_name: "Kabir", last_name: "Nair", created_at: "2026-03-05T06:00:00.000Z" },
      { id: ADMIN_ID, email: "owner@example.com", first_name: "Owner", created_at: "2025-12-01T06:00:00.000Z" }
    );
    order({ customer_id: CUSTOMER_A, total: 1000 });
    order({ customer_id: CUSTOMER_A, total: 600, refunded_amount: 100, payment_status: "partially_refunded" });
    order({ customer_id: CUSTOMER_B, total: 400, payment_status: "pending", placed_at: null });
  });
  const customers = (query: string, as = ADMIN_ID) => api().get(`/api/admin/customers?${query}`).set(auth(as));

  it("lists customers (not admins) with net spend, and sorts on it", async () => {
    const res = await customers("sort=spent&dir=desc");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0]).toMatchObject({ firstName: "Priya", orderCount: 2, totalSpent: 1500 });
    expect(res.body.items[1]).toMatchObject({ firstName: "Kabir", orderCount: 0, totalSpent: 0 });
    expect(res.body.stats).toMatchObject({ totalSpent: 1500, maxSpent: 1500 });
  });

  it("searches and filters server-side", async () => {
    expect((await customers("q=nair")).body.items.map((c: { firstName: string }) => c.firstName)).toEqual(["Kabir"]);
    expect((await customers("q=987654")).body.items.map((c: { firstName: string }) => c.firstName)).toEqual(["Priya"]);
    expect((await customers("minOrders=1")).body.total).toBe(1);
    expect((await customers("from=2026-03-01&to=2026-03-31")).body.total).toBe(1);
  });

  it("requires customers.export to export", async () => {
    expect((await api().get("/api/admin/customers/export").set(auth(STAFF_ID))).status).toBe(403);
    const res = await api().get("/api/admin/customers/export").set(auth(ADMIN_ID));
    expect(res.status).toBe(200);
    expect(res.text).toContain("priya@example.com");
    expect(res.text).not.toContain("owner@example.com");
  });
});
