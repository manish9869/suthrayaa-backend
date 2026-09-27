import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, auth, seed, placeCodOrder, ADDRESS, ADMIN_ID, STAFF_ID, CUSTOMER_A, CUSTOMER_B, PRODUCT_ID } from "./helpers.js";
import { db } from "./db.js";
import { razorpay } from "../config/razorpay.js";

// Kept under the sensitive limiter's 30 writes per window — every place-order / cancel counts.

const COUPON_ID = "dddddddd-0000-4000-8000-000000000001";
const refundSpy = razorpay.payments.refund as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  seed();
  refundSpy.mockClear();
});

const stock = () => db.table("products").find((p) => p.id === PRODUCT_ID)!.stock as number;
const order = (id: string) => db.table("orders").find((o) => o.id === id)!;
const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}) =>
  api().patch(`/api/admin/orders/${id}/status`).set(auth(ADMIN_ID)).send({ status, ...extra });
const refund = (id: string, body: Record<string, unknown>, as = ADMIN_ID) =>
  api().post(`/api/admin/orders/${id}/refund`).set(auth(as)).send(body);

/** A razorpay order for 2 units (₹1,000), paid and verified. */
async function placePaidOnline(userId = CUSTOMER_A) {
  const placed = await api()
    .post("/api/checkout/place-order")
    .set(auth(userId))
    .send({ items: [{ productId: PRODUCT_ID, quantity: 2 }], shippingAddress: ADDRESS, shippingMethod: "standard", paymentMethod: "razorpay" });
  expect(placed.status).toBe(201);
  const rzpOrder = placed.body.razorpay.orderId as string;
  const signature = crypto.createHmac("sha256", "rzp_test_secret").update(`${rzpOrder}|pay_1`).digest("hex");
  const verified = await api().post("/api/checkout/verify-payment").send({ razorpayOrderId: rzpOrder, razorpayPaymentId: "pay_1", razorpaySignature: signature });
  expect(verified.status).toBe(200);
  return placed.body.order.id as string;
}

describe("order status transitions", () => {
  it("marks Cash on Delivery paid when it's delivered", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    expect(order(body.order.id).payment_status).toBe("pending");
    expect((await setStatus(body.order.id, "shipped")).status).toBe(200);
    expect(order(body.order.id).payment_status).toBe("pending");
    expect((await setStatus(body.order.id, "delivered")).status).toBe(200);
    expect(order(body.order.id)).toMatchObject({ status: "delivered", payment_status: "paid" });
    expect(order(body.order.id).paid_at).toBeTruthy();
  });

  it("rejects moves that skip the lifecycle", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    await setStatus(body.order.id, "shipped");
    await setStatus(body.order.id, "delivered");
    expect((await setStatus(body.order.id, "pending_payment")).status).toBe(400);
    expect((await setStatus(body.order.id, "cancelled")).status).toBe(400);
    expect(order(body.order.id).status).toBe("delivered");
  });

  it("never lets an admin confirm an unpaid online order", async () => {
    const placed = await api()
      .post("/api/checkout/place-order")
      .set(auth(CUSTOMER_A))
      .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }], shippingAddress: ADDRESS, shippingMethod: "standard", paymentMethod: "razorpay" });
    expect((await setStatus(placed.body.order.id, "confirmed")).status).toBe(400);
  });

  it("sends refunds through the refund action, not the status dropdown", async () => {
    const id = await placePaidOnline();
    expect((await setStatus(id, "refunded")).status).toBe(400);
    expect(order(id).payment_status).toBe("paid");
  });

  it("saves tracking on the same status without a new history entry", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    await setStatus(body.order.id, "shipped");
    const before = db.table("order_status_history").length;
    const res = await setStatus(body.order.id, "shipped", { trackingNumber: "TRK123", courier: "Delhivery" });
    expect(res.status).toBe(200);
    expect(order(body.order.id)).toMatchObject({ tracking_number: "TRK123", courier: "Delhivery" });
    expect(db.table("order_status_history")).toHaveLength(before);
  });
});

describe("stock is returned at most once", () => {
  it("admin cancel returns stock once; a repeat cancel is refused", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    expect(stock()).toBe(4);
    expect((await setStatus(body.order.id, "cancelled")).status).toBe(200);
    expect(stock()).toBe(5);
    await setStatus(body.order.id, "cancelled");
    expect(stock()).toBe(5);
  });

  it("customer cancel then admin refund doesn't restock twice", async () => {
    const id = await placePaidOnline();
    expect(stock()).toBe(3);
    const cancelled = await api().post(`/api/me/orders/${id}/cancel`).set(auth(CUSTOMER_A)).send({});
    expect(cancelled.status).toBe(200);
    expect(stock()).toBe(5);
    const res = await refund(id, { reason: "Customer cancelled", restock: true });
    expect(res.status).toBe(201);
    expect(stock()).toBe(5);
  });

  it("two concurrent customer cancels return stock once", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    const results = await Promise.all([
      api().post(`/api/me/orders/${body.order.id}/cancel`).set(auth(CUSTOMER_A)).send({}),
      api().post(`/api/me/orders/${body.order.id}/cancel`).set(auth(CUSTOMER_A)).send({}),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(stock()).toBe(5);
  });

  it("admin cancel of a paid order flags a refund instead of claiming one", async () => {
    const id = await placePaidOnline();
    const res = await setStatus(id, "cancelled");
    expect(res.body.refundRequired).toBe(true);
    expect(order(id).payment_status).toBe("paid");
    expect(refundSpy).not.toHaveBeenCalled();
  });
});

describe("refunds", () => {
  it("refunds in full through Razorpay, records it and restocks unshipped items", async () => {
    const id = await placePaidOnline();
    const res = await refund(id, { reason: "Out of yarn" });
    expect(res.status).toBe(201);
    expect(refundSpy).toHaveBeenCalledWith("pay_1", expect.objectContaining({ amount: 100000 }));
    expect(order(id)).toMatchObject({ status: "refunded", payment_status: "refunded", refunded_amount: 1000 });
    expect(db.table("order_refunds")).toHaveLength(1);
    expect(db.table("order_refunds")[0]).toMatchObject({ amount: 1000, method: "razorpay", restocked: true });
    expect(stock()).toBe(5);
    expect(db.table("audit_logs").some((l) => l.action === "ORDER_REFUNDED")).toBe(true);
  });

  it("supports partial refunds and never refunds more than was paid", async () => {
    const id = await placePaidOnline();
    expect((await refund(id, { amount: 300, reason: "Damaged tag" })).status).toBe(201);
    expect(order(id)).toMatchObject({ payment_status: "partially_refunded", status: "confirmed", refunded_amount: 300 });
    expect(stock()).toBe(3); // partial refunds keep the order — and its stock
    expect((await refund(id, { amount: 800, reason: "Too much" })).status).toBe(400);
    expect((await refund(id, { reason: "Rest of it" })).status).toBe(201);
    expect(refundSpy).toHaveBeenLastCalledWith("pay_1", expect.objectContaining({ amount: 70000 }));
    expect(order(id)).toMatchObject({ payment_status: "refunded", refunded_amount: 1000 });
    expect((await refund(id, { amount: 1, reason: "Again" })).status).toBe(400);
  });

  it("rolls back when the gateway refuses the refund", async () => {
    const id = await placePaidOnline();
    refundSpy.mockRejectedValueOnce({ error: { description: "Insufficient balance" } });
    const res = await refund(id, { reason: "Out of yarn" });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Insufficient balance/);
    expect(order(id)).toMatchObject({ payment_status: "paid", refunded_amount: 0 });
    expect(db.table("order_refunds")).toHaveLength(0);
  });

  it("records COD refunds as manual and refuses unpaid orders", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    expect((await refund(body.order.id, { reason: "Not delivered yet" })).status).toBe(400);
    await setStatus(body.order.id, "shipped");
    await setStatus(body.order.id, "delivered");
    const res = await refund(body.order.id, { reason: "Returned" });
    expect(res.status).toBe(201);
    expect(refundSpy).not.toHaveBeenCalled();
    expect(db.table("order_refunds")[0]).toMatchObject({ method: "manual", restocked: false });
  });

  it("requires the orders.refund permission", async () => {
    const id = await placePaidOnline();
    expect((await refund(id, { reason: "x" }, STAFF_ID)).status).toBe(403);
    expect(refundSpy).not.toHaveBeenCalled();
  });
});

describe("coupon limits", () => {
  it("loses a coupon's last use cleanly when another checkout takes it first", async () => {
    const coupon = db.table("coupons").find((c) => c.id === COUPON_ID)!;
    coupon.max_uses = 1;
    // Another customer's checkout redeems the last use between our validation and our increment
    const real = db.rpcHandlers.try_increment_coupon_uses;
    db.rpcHandlers.try_increment_coupon_uses = (args, fake) => {
      coupon.uses_count = 1;
      return real(args, fake);
    };
    try {
      const res = await placeCodOrder(CUSTOMER_A, undefined, { couponCode: "WELCOME10" });
      expect(res.status).toBe(409);
    } finally {
      db.rpcHandlers.try_increment_coupon_uses = real;
    }
    expect(coupon.uses_count).toBe(1);
    expect(db.table("orders")).toHaveLength(0);
    expect(db.table("coupon_redemptions")).toHaveLength(0);
    expect(stock()).toBe(5); // the losing order's reservation was put back
  });

  it("stops at the usage limit", async () => {
    db.table("coupons")[0].max_uses = 1;
    expect((await placeCodOrder(CUSTOMER_A, undefined, { couponCode: "WELCOME10" })).status).toBe(201);
    expect((await placeCodOrder(CUSTOMER_B, undefined, { couponCode: "WELCOME10" })).status).toBe(400);
    expect(db.table("coupons")[0].uses_count).toBe(1);
  });

  it("applies once-per-customer limits to guests by email", async () => {
    const guest = (email: string) =>
      api()
        .post("/api/checkout/place-order")
        .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }], shippingAddress: { ...ADDRESS, email }, shippingMethod: "standard", paymentMethod: "cod", couponCode: "WELCOME10" });
    expect((await guest("guest@example.com")).status).toBe(201);
    expect((await guest("GUEST@example.com")).status).toBe(400);
    expect((await guest("other@example.com")).status).toBe(201);
  });
});
