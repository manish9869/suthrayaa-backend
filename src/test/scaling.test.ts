import { beforeEach, describe, expect, it } from "vitest";
import { api, auth, seed, CUSTOMER_A } from "./helpers.js";

beforeEach(() => seed());

describe("edge caching of public reads", () => {
  it("marks anonymous catalog reads as CDN-cacheable", async () => {
    const res = await api().get("/api/products");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/public.*s-maxage=60/);
  });

  it("never caches requests with credentials, error responses or private routes", async () => {
    expect((await api().get("/api/products").set(auth(CUSTOMER_A))).headers["cache-control"]).toBeUndefined();
    expect((await api().get("/api/products/does-not-exist")).headers["cache-control"]).toBeUndefined();
    expect((await api().get("/api/me/orders").set(auth(CUSTOMER_A))).headers["cache-control"] ?? "").not.toMatch(/public/);
  });
});

describe("payment callbacks under load", () => {
  it("does not throttle payment verification with the shared write limiter", async () => {
    for (let i = 0; i < 35; i++) {
      const res = await api()
        .post("/api/checkout/verify-payment")
        .send({ razorpayOrderId: "order_x", razorpayPaymentId: "pay_x", razorpaySignature: "bad" });
      expect(res.status).toBe(400); // rejected by signature check, never 429
    }
  });
});
