import { beforeEach, describe, expect, it } from "vitest";
import { api, auth, seed, placeCodOrder, ADMIN_ID, STAFF_ID, CUSTOMER_A, CUSTOMER_B, PRODUCT_ID, SIZED_PRODUCT_ID, SIZE_GROUP_ID, SIZE_SMALL_ID } from "./helpers.js";
import { db } from "./db.js";

beforeEach(() => seed());

const setStatus = (id: string, status: string, extra: Record<string, unknown> = {}) =>
  api().patch(`/api/admin/orders/${id}/status`).set(auth(ADMIN_ID)).send({ status, ...extra });
const orderDetail = (id: string, as = CUSTOMER_A) => api().get(`/api/me/orders/${id}`).set(auth(as));
const requestReturn = (id: string, body: Record<string, unknown>, as = CUSTOMER_A) => api().post(`/api/me/orders/${id}/returns`).set(auth(as)).send(body);
const decide = (returnId: string, status: string, adminNote?: string, as = ADMIN_ID) =>
  api().patch(`/api/admin/returns/${returnId}`).set(auth(as)).send({ status, adminNote });

/** A delivered COD order (2 × the plain product, plus optionally a personalised line). */
async function deliveredOrder(personalised = false) {
  const items: Record<string, unknown>[] = [{ productId: PRODUCT_ID, quantity: 2 }];
  if (personalised) items.push({ productId: SIZED_PRODUCT_ID, quantity: 1, customizations: [{ customizationId: SIZE_GROUP_ID, valueId: SIZE_SMALL_ID }] });
  const placed = await placeCodOrder(CUSTOMER_A, items as never);
  expect(placed.status).toBe(201);
  const id = placed.body.order.id as string;
  expect((await setStatus(id, "shipped")).status).toBe(200);
  expect((await setStatus(id, "delivered")).status).toBe(200);
  const lines = db.table("order_items").filter((i) => i.order_id === id);
  return { id, plain: lines.find((l) => l.product_id === PRODUCT_ID)!.id as string, custom: lines.find((l) => l.product_id === SIZED_PRODUCT_ID)?.id as string };
}

describe("return eligibility", () => {
  it("opens once the order is delivered, within the window", async () => {
    const placed = await placeCodOrder(CUSTOMER_A);
    const before = await orderDetail(placed.body.order.id);
    expect(before.body.returns).toMatchObject({ canRequest: false });
    expect(before.body.returns.blockedReason).toMatch(/delivered/);

    const { id } = await deliveredOrder();
    const after = await orderDetail(id);
    expect(after.body.returns.canRequest).toBe(true);
    expect(after.body.returns.deadline).toBeTruthy();
  });

  it("closes after the return window", async () => {
    const { id, plain } = await deliveredOrder();
    for (const h of db.table("order_status_history").filter((x) => x.order_id === id && x.status === "delivered")) {
      h.created_at = new Date(Date.now() - 10 * 86_400_000).toISOString();
    }
    const res = await requestReturn(id, { type: "return", reason: "changed_mind", items: [{ orderItemId: plain, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/7-day return window/);
  });

  it("lets personalised pieces come back only when damaged, defective or wrong", async () => {
    const { id, custom } = await deliveredOrder(true);
    const refused = await requestReturn(id, { type: "return", reason: "changed_mind", items: [{ orderItemId: custom, quantity: 1 }] });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/personalised/);
    const ok = await requestReturn(id, { type: "return", reason: "damaged", items: [{ orderItemId: custom, quantity: 1 }] });
    expect(ok.status).toBe(201);
  });

  it("allows one open request per order, and no more units than were bought", async () => {
    const { id, plain } = await deliveredOrder();
    expect((await requestReturn(id, { type: "return", reason: "changed_mind", items: [{ orderItemId: plain, quantity: 3 }] })).status).toBe(400);
    expect((await requestReturn(id, { type: "exchange", reason: "size_or_fit", items: [{ orderItemId: plain, quantity: 1 }] })).status).toBe(201);
    const again = await requestReturn(id, { type: "return", reason: "changed_mind", items: [{ orderItemId: plain, quantity: 1 }] });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toMatch(/already a return in progress/);
  });

  it("keeps other customers out", async () => {
    const { id, plain } = await deliveredOrder();
    expect((await requestReturn(id, { type: "return", reason: "damaged", items: [{ orderItemId: plain, quantity: 1 }] }, CUSTOMER_B)).status).toBe(404);
  });
});

describe("return workflow", () => {
  it("approve → received → refund settles the return and links the refund", async () => {
    const { id, plain } = await deliveredOrder();
    const created = await requestReturn(id, { type: "return", reason: "damaged", details: "Petal came loose", items: [{ orderItemId: plain, quantity: 1 }] });
    const returnId = created.body.id as string;

    expect((await decide(returnId, "received")).status).toBe(400); // must be approved first
    expect((await decide(returnId, "approved")).status).toBe(200);
    expect((await decide(returnId, "received")).status).toBe(200);

    const refund = await api().post(`/api/admin/orders/${id}/refund`).set(auth(ADMIN_ID)).send({ amount: 500, reason: "Return received" });
    expect(refund.status).toBe(201);
    const row = db.table("return_requests").find((r) => r.id === returnId)!;
    expect(row).toMatchObject({ status: "refunded", refund_id: refund.body.refund.id });

    const detail = await api().get(`/api/admin/orders/${id}`).set(auth(ADMIN_ID));
    expect(detail.body.returnRequests[0]).toMatchObject({ status: "refunded", reasonLabel: "Arrived damaged" });
    expect(detail.body.returnRequests[0].items[0]).toMatchObject({ quantity: 1, name: "Amigurumi Bunny" });
  });

  it("needs a reason to decline, and exchanges close as exchanged", async () => {
    const { id, plain } = await deliveredOrder();
    const created = await requestReturn(id, { type: "exchange", reason: "size_or_fit", items: [{ orderItemId: plain, quantity: 1 }] });
    expect((await decide(created.body.id, "rejected")).status).toBe(400);
    await decide(created.body.id, "approved");
    await decide(created.body.id, "received");
    const done = await decide(created.body.id, "exchanged");
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("exchanged");
    // closed — a new request can be made for the other unit
    expect((await requestReturn(id, { type: "return", reason: "damaged", items: [{ orderItemId: plain, quantity: 1 }] })).status).toBe(201);
  });

  it("lets the customer withdraw until the parcel is received", async () => {
    const { id, plain } = await deliveredOrder();
    const created = await requestReturn(id, { type: "return", reason: "changed_mind", items: [{ orderItemId: plain, quantity: 1 }] });
    await decide(created.body.id, "approved");
    await decide(created.body.id, "received");
    expect((await api().post(`/api/me/returns/${created.body.id}/cancel`).set(auth(CUSTOMER_A))).status).toBe(400);
  });

  it("lists open returns for staff but only orders.update can decide", async () => {
    const { id, plain } = await deliveredOrder();
    const created = await requestReturn(id, { type: "return", reason: "damaged", items: [{ orderItemId: plain, quantity: 1 }] });
    const list = await api().get("/api/admin/returns").set(auth(STAFF_ID));
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ total: 1, openCount: 1 });
    expect(list.body.items[0].order.orderNumber).toBeTruthy();
    expect((await decide(created.body.id, "approved", undefined, STAFF_ID)).status).toBe(403);
  });
});

describe("tracking links and cancellation setting", () => {
  it("shows the courier's tracking link to the customer, and rejects non-web links", async () => {
    const placed = await placeCodOrder(CUSTOMER_A);
    const id = placed.body.order.id;
    expect((await setStatus(id, "shipped", { trackingNumber: "AB123", trackingUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await setStatus(id, "shipped", { trackingNumber: "AB123", courier: "Delhivery", trackingUrl: "https://track.example.com/AB123" })).status).toBe(200);
    const detail = await orderDetail(id);
    expect(detail.body).toMatchObject({ trackingNumber: "AB123", courier: "Delhivery", trackingUrl: "https://track.example.com/AB123" });
  });

  it("honours 'Allow order cancellation' being switched off", async () => {
    db.table("site_settings").push({ key: "order.allow_cancellation", value: false });
    const placed = await placeCodOrder(CUSTOMER_A);
    const detail = await orderDetail(placed.body.order.id);
    expect(detail.body.canCancel).toBe(false);
    expect((await api().post(`/api/me/orders/${placed.body.order.id}/cancel`).set(auth(CUSTOMER_A)).send({})).status).toBe(400);
  });
});
