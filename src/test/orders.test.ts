import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { api, auth, seed, placeCodOrder, ADDRESS, CUSTOMER_A, CUSTOMER_B, PRODUCT_ID } from "./helpers.js";
import { db } from "./db.js";

beforeEach(() => seed());

const stock = () => db.table("products").find((p) => p.id === PRODUCT_ID)!.stock as number;
const settle = () => new Promise((r) => setTimeout(r, 30)); // let fire-and-forget work finish

async function placeOnline(userId = CUSTOMER_A, extra: Record<string, unknown> = {}) {
  const res = await api()
    .post("/api/checkout/place-order")
    .set(auth(userId))
    .send({ items: [{ productId: PRODUCT_ID, quantity: 2 }], shippingAddress: ADDRESS, shippingMethod: "standard", paymentMethod: "razorpay", ...extra });
  expect(res.status).toBe(201);
  return res.body as { order: { id: string }; razorpay: { orderId: string } };
}

const sign = (orderId: string, paymentId: string) => crypto.createHmac("sha256", "rzp_test_secret").update(`${orderId}|${paymentId}`).digest("hex");
const webhook = (event: object) => {
  const body = JSON.stringify(event);
  return api()
    .post("/api/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("x-razorpay-signature", crypto.createHmac("sha256", "whsec_test").update(body).digest("hex"))
    .send(body);
};

describe("order history & ownership", () => {
  it("lists only the customer's own orders", async () => {
    await placeCodOrder(CUSTOMER_A);
    await placeCodOrder(CUSTOMER_B);
    const mine = await api().get("/api/me/orders").set(auth(CUSTOMER_A));
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
  });

  it("shows order detail to its owner only (no IDOR)", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    const own = await api().get(`/api/me/orders/${body.order.id}`).set(auth(CUSTOMER_A));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ id: body.order.id, status: "confirmed", canCancel: true });
    const other = await api().get(`/api/me/orders/${body.order.id}`).set(auth(CUSTOMER_B));
    expect(other.status).toBe(404);
  });

  it("downloads the invoice PDF for the owner only", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    const pdf = await api().get(`/api/me/orders/${body.order.id}/invoice`).set(auth(CUSTOMER_A)).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");
    const other = await api().get(`/api/me/orders/${body.order.id}/invoice`).set(auth(CUSTOMER_B));
    expect(other.status).toBe(404);
    // one invoice per order, even after repeated downloads
    await api().get(`/api/me/orders/${body.order.id}/invoice`).set(auth(CUSTOMER_A));
    await settle();
    expect(db.table("invoices").filter((i) => i.order_id === body.order.id)).toHaveLength(1);
  });

  it("holds back the invoice until an online order is paid", async () => {
    const { order } = await placeOnline();
    const res = await api().get(`/api/me/orders/${order.id}/invoice`).set(auth(CUSTOMER_A));
    expect(res.status).toBe(400);
  });
});

describe("cancellation", () => {
  it("lets the owner cancel a confirmed COD order and returns the stock", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    expect(stock()).toBe(4);
    const res = await api().post(`/api/me/orders/${body.order.id}/cancel`).set(auth(CUSTOMER_A)).send({ reason: "Ordered by mistake" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(stock()).toBe(5);
  });

  it("doesn't return stock that an unpaid online order never took", async () => {
    const { order } = await placeOnline();
    await api().post(`/api/me/orders/${order.id}/cancel`).set(auth(CUSTOMER_A)).send({});
    expect(stock()).toBe(5);
  });

  it("refuses to cancel orders already being made, or someone else's", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    expect((await api().post(`/api/me/orders/${body.order.id}/cancel`).set(auth(CUSTOMER_B)).send({})).status).toBe(404);
    db.table("orders")[0].status = "shipped";
    expect((await api().post(`/api/me/orders/${body.order.id}/cancel`).set(auth(CUSTOMER_A)).send({})).status).toBe(400);
  });
});

describe("online payment", () => {
  it("rejects a forged payment signature", async () => {
    const { razorpay } = await placeOnline();
    const res = await api().post("/api/checkout/verify-payment").send({ razorpayOrderId: razorpay.orderId, razorpayPaymentId: "pay_1", razorpaySignature: "forged" });
    expect(res.status).toBe(400);
    expect(db.table("orders")[0].payment_status).toBe("pending");
  });

  it("confirms a verified payment once, however many times it's reported", async () => {
    const { razorpay } = await placeOnline(CUSTOMER_A, { couponCode: "WELCOME10" });
    const body = { razorpayOrderId: razorpay.orderId, razorpayPaymentId: "pay_1", razorpaySignature: sign(razorpay.orderId, "pay_1") };
    const captured = { event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: razorpay.orderId } } } };
    // client verify + webhook + a replayed verify, all at once
    const results = await Promise.all([api().post("/api/checkout/verify-payment").send(body), webhook(captured), api().post("/api/checkout/verify-payment").send(body)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    await settle();
    expect(db.table("orders")[0]).toMatchObject({ payment_status: "paid", status: "confirmed" });
    expect(stock()).toBe(3); // reserved exactly once
    expect(db.table("coupon_redemptions")).toHaveLength(1);
    expect(db.table("coupons")[0].uses_count).toBe(1);
    expect(db.table("order_status_history").filter((h) => h.note === "Payment verified via Razorpay")).toHaveLength(1);
  });

  it("keeps a cancelled order cancelled when a late payment arrives (flagged for refund)", async () => {
    const { order, razorpay } = await placeOnline();
    await api().post(`/api/me/orders/${order.id}/cancel`).set(auth(CUSTOMER_A)).send({});
    await webhook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_9", order_id: razorpay.orderId } } } });
    expect(db.table("orders")[0]).toMatchObject({ status: "cancelled", payment_status: "paid" });
    expect(db.table("order_status_history").some((h) => /refund required/.test(h.note ?? ""))).toBe(true);
    expect(stock()).toBe(5);
  });

  it("rejects webhooks with a bad signature", async () => {
    const res = await api().post("/api/webhooks/razorpay").set("Content-Type", "application/json").set("x-razorpay-signature", "nope").send("{}");
    expect(res.status).toBe(400);
  });

  it("marks failed payments and lets the owner retry — nobody else", async () => {
    const { order, razorpay } = await placeOnline();
    await webhook({ event: "payment.failed", payload: { payment: { entity: { id: "pay_x", order_id: razorpay.orderId } } } });
    expect(db.table("orders")[0].payment_status).toBe("failed");
    expect((await api().post(`/api/me/orders/${order.id}/pay`).set(auth(CUSTOMER_B))).status).toBe(404);
    const retry = await api().post(`/api/me/orders/${order.id}/pay`).set(auth(CUSTOMER_A));
    expect(retry.status).toBe(200);
    expect(retry.body.razorpay.orderId).not.toBe(razorpay.orderId);
  });

  it("refuses to pay for COD or already-paid orders", async () => {
    const { body } = await placeCodOrder(CUSTOMER_A);
    expect((await api().post(`/api/me/orders/${body.order.id}/pay`).set(auth(CUSTOMER_A))).status).toBe(400);
  });
});
