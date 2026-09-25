import { beforeEach, describe, expect, it } from "vitest";
import { api, auth, seed, placeCodOrder, ADDRESS, CUSTOMER_A, PRODUCT_ID, SIZED_PRODUCT_ID, HIDDEN_PRODUCT_ID, SIZE_GROUP_ID, SIZE_LARGE_ID } from "./helpers.js";
import { db } from "./db.js";

beforeEach(() => seed());

const price = (items: unknown[], extra: Record<string, unknown> = {}) => api().post("/api/checkout/validate-cart").send({ items, ...extra });

describe("server-side pricing", () => {
  it("prices from the database and ignores client-sent prices, discounts and totals", async () => {
    const res = await price([{ productId: PRODUCT_ID, quantity: 2, price: 1, unitPrice: 1, lineTotal: 1 }], { total: 1, discount: 999, subtotal: 1 });
    expect(res.status).toBe(200);
    expect(res.body.subtotal).toBe(1000);
    expect(res.body.discount).toBe(0);
    expect(res.body.total).toBeGreaterThanOrEqual(1000);
  });

  it("applies option price adjustments from the database", async () => {
    const res = await price([{ productId: SIZED_PRODUCT_ID, quantity: 1, customizations: [{ customizationId: SIZE_GROUP_ID, valueId: SIZE_LARGE_ID }] }]);
    expect(res.body.error).toBeUndefined();
    expect(res.body.subtotal).toBe(900);
  });

  it("recomputes the coupon discount server-side and rejects unknown codes", async () => {
    const ok = await price([{ productId: PRODUCT_ID, quantity: 2 }], { couponCode: "welcome10" });
    expect(ok.body.discount).toBe(100);
    const bad = await price([{ productId: PRODUCT_ID, quantity: 2 }], { couponCode: "FREE100" });
    expect(bad.status).toBe(400);
  });
});

describe("cart validation", () => {
  it("requires every required option (e.g. size)", async () => {
    const res = await price([{ productId: SIZED_PRODUCT_ID, quantity: 1 }]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/choose size/i);
  });

  it("rejects option values that don't belong to the product", async () => {
    const res = await price([{ productId: SIZED_PRODUCT_ID, quantity: 1, customizations: [{ customizationId: SIZE_GROUP_ID, valueId: "cccccccc-0000-4000-8000-00000000dead" }] }]);
    expect(res.status).toBe(400);
  });

  it("rejects unknown, archived and sold-out products", async () => {
    expect((await price([{ productId: "aaaaaaaa-0000-4000-8000-00000000abcd", quantity: 1 }])).status).toBe(400);
    expect((await price([{ productId: HIDDEN_PRODUCT_ID, quantity: 1 }])).status).toBe(400);
    db.table("products").find((p) => p.id === PRODUCT_ID)!.status = "out_of_stock";
    const sold = await price([{ productId: PRODUCT_ID, quantity: 1 }]);
    expect(sold.status).toBe(400);
    expect(sold.body.error.message).toMatch(/sold out/i);
  });

  it("rejects invalid quantities", async () => {
    for (const q of [0, -3, 21, 2.5]) expect((await price([{ productId: PRODUCT_ID, quantity: q }])).status).toBe(400);
  });

  it("enforces stock across lines of the same product", async () => {
    expect((await price([{ productId: PRODUCT_ID, quantity: 6 }])).status).toBe(400);
    const split = await price([
      { productId: PRODUCT_ID, quantity: 3, selectedColor: "#fff" },
      { productId: PRODUCT_ID, quantity: 3, selectedColor: "#000" },
    ]);
    expect(split.status).toBe(400);
    expect(split.body.error.message).toMatch(/only has 5 left/);
  });

  it("check-cart reports every problem line at once", async () => {
    const res = await api()
      .post("/api/checkout/check-cart")
      .send({ items: [{ productId: SIZED_PRODUCT_ID, quantity: 1 }, { productId: PRODUCT_ID, quantity: 1 }, { productId: HIDDEN_PRODUCT_ID, quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.issues).toEqual([
      expect.objectContaining({ index: 0, kind: "options" }),
      expect.objectContaining({ index: 2, kind: "unavailable" }),
    ]);
  });
});

describe("placing orders", () => {
  it("creates a COD order with server totals, reserves stock and links the customer", async () => {
    const res = await placeCodOrder(CUSTOMER_A, [{ productId: PRODUCT_ID, quantity: 2 }], { total: 1, discount: 500 });
    expect(res.status).toBe(201);
    const order = db.table("orders")[0];
    expect(order).toMatchObject({ customer_id: CUSTOMER_A, subtotal: 1000, discount_amount: 0, status: "confirmed" });
    expect(Number(order.total)).toBeGreaterThanOrEqual(1000);
    expect(db.table("products").find((p) => p.id === PRODUCT_ID)!.stock).toBe(3);
    expect(db.table("order_items")).toHaveLength(1);
  });

  it("rejects missing or invalid address fields", async () => {
    for (const bad of [{ ...ADDRESS, pincode: "999" }, { ...ADDRESS, phone: "12" }, { ...ADDRESS, state: "Nowhere" }, { ...ADDRESS, firstName: "" }, { ...ADDRESS, email: "not-an-email" }]) {
      const res = await api().post("/api/checkout/place-order").send({ items: [{ productId: PRODUCT_ID, quantity: 1 }], shippingAddress: bad, shippingMethod: "standard", paymentMethod: "cod" });
      expect(res.status).toBe(400);
    }
    expect(db.table("orders")).toHaveLength(0);
  });

  it("rejects an order missing a required option before anything is created", async () => {
    const res = await placeCodOrder(CUSTOMER_A, [{ productId: SIZED_PRODUCT_ID, quantity: 1 }]);
    expect(res.status).toBe(400);
    expect(db.table("orders")).toHaveLength(0);
  });

  it("rejects unknown payment methods", async () => {
    const res = await placeCodOrder(CUSTOMER_A, undefined, { paymentMethod: "free" });
    expect(res.status).toBe(400);
  });

  it("returns the same order for a repeated submit (idempotency key)", async () => {
    const key = "9b2f4f7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    const first = await placeCodOrder(CUSTOMER_A, undefined, { idempotencyKey: key });
    const again = await placeCodOrder(CUSTOMER_A, undefined, { idempotencyKey: key });
    expect(again.status).toBe(201);
    expect(again.body.order.id).toBe(first.body.order.id);
    expect(db.table("orders")).toHaveLength(1);
    expect(db.table("products").find((p) => p.id === PRODUCT_ID)!.stock).toBe(4);
  });

  it("never oversells the last item under concurrent orders", async () => {
    db.table("products").find((p) => p.id === PRODUCT_ID)!.stock = 1;
    const results = await Promise.all([placeCodOrder(CUSTOMER_A), placeCodOrder(CUSTOMER_A)]);
    const statuses = results.map((r) => r.status).sort()
    expect(statuses[0]).toBe(201)
    expect([400, 409]).toContain(statuses[1])
    expect(db.table("orders")).toHaveLength(1);
    expect(db.table("products").find((p) => p.id === PRODUCT_ID)!.stock).toBe(0);
  });

  it("enforces COD limits from settings", async () => {
    db.table("site_settings").push({ key: "payment.cod_max_amount", value: 100 });
    const res = await placeCodOrder(CUSTOMER_A);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Cash on Delivery/);
  });

  it("uses a coupon only as many times as allowed per customer", async () => {
    const first = await placeCodOrder(CUSTOMER_A, undefined, { couponCode: "WELCOME10" });
    expect(first.status).toBe(201);
    const second = await placeCodOrder(CUSTOMER_A, undefined, { couponCode: "WELCOME10" });
    expect(second.status).toBe(400);
  });
});
