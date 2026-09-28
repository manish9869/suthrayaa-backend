import { beforeEach, describe, expect, it } from "vitest";
import { api, auth, seed, ADMIN_ID, STAFF_ID } from "./helpers.js";
import { db } from "./db.js";

beforeEach(() => seed());
const settle = () => new Promise((r) => setTimeout(r, 20)); // the log is written after the response finishes
const logs = () => db.table("audit_logs");

describe("write auditing", () => {
  it("logs creates against the new record, with the fields that were sent", async () => {
    const res = await api().post("/api/admin/coupons").set(auth(ADMIN_ID)).send({ code: "summer20", type: "percent", value: 20 });
    expect(res.status).toBe(201);
    await settle();
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ user_id: ADMIN_ID, action: "COUPON_CREATED", resource: "coupons", resource_id: res.body.id });
    expect(logs()[0].metadata.changes).toMatchObject({ code: "summer20", value: 20 });
  });

  it("logs updates and deletes by id", async () => {
    const id = db.table("coupons")[0].id;
    await api().patch(`/api/admin/coupons/${id}`).set(auth(ADMIN_ID)).send({ isActive: false });
    await api().delete(`/api/admin/coupons/${id}`).set(auth(ADMIN_ID));
    await settle();
    expect(logs().map((l) => [l.action, l.resource_id])).toEqual([
      ["COUPON_UPDATED", id],
      ["COUPON_DELETED", id],
    ]);
  });

  it("doesn't log refused requests", async () => {
    const res = await api().post("/api/admin/coupons").set(auth(STAFF_ID)).send({ code: "NOPE", type: "flat", value: 5 });
    expect(res.status).toBe(403);
    await settle();
    expect(logs()).toHaveLength(0);
  });
});
