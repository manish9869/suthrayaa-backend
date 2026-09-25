import { beforeEach, describe, expect, it } from "vitest";
import { api, auth, seed, ADMIN_ID, CUSTOMER_A, STAFF_ID } from "./helpers.js";
import { db } from "./db.js";

beforeEach(() => seed());

describe("authentication", () => {
  it("rejects customer endpoints without a token", async () => {
    const res = await api().get("/api/me");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed or expired token", async () => {
    for (const header of ["Bearer nonsense", "Bearer expired.token.value", "Token abc"]) {
      const res = await api().get("/api/me").set("Authorization", header);
      expect(res.status).toBe(401);
    }
  });

  it("accepts a valid token and lazily creates the profile", async () => {
    const res = await api().get("/api/me").set(auth(CUSTOMER_A, "priya@example.com"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: CUSTOMER_A, email: "priya@example.com" });
    expect(db.table("customer_profiles")).toHaveLength(1);
  });

  it("never echoes internal error details", async () => {
    const res = await api().post("/api/checkout/validate-cart").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at JSON|stack/);
  });
});

describe("authorization", () => {
  it("blocks customers from admin APIs", async () => {
    const res = await api().get("/api/admin/orders").set(auth(CUSTOMER_A));
    expect(res.status).toBe(403);
  });

  it("blocks deactivated admins", async () => {
    db.table("admin_users").find((a) => a.id === STAFF_ID)!.is_active = false;
    const res = await api().get("/api/admin/orders").set(auth(STAFF_ID));
    expect(res.status).toBe(403);
  });

  it("enforces per-route permissions for admins", async () => {
    // Order Viewer has orders.view but not orders.update
    const ok = await api().get("/api/admin/orders").set(auth(STAFF_ID));
    expect(ok.status).toBe(200);
    const denied = await api()
      .patch("/api/admin/orders/aaaaaaaa-0000-4000-8000-00000000ffff/status")
      .set(auth(STAFF_ID))
      .send({ status: "shipped" });
    expect(denied.status).toBe(403);
  });
});

describe("privilege escalation", () => {
  const ORDER_VIEWER = "eeeeeeee-0000-4000-8000-000000000002";
  const MANAGER = "eeeeeeee-0000-4000-8000-000000000003";

  it("an admin can't add permissions they don't hold to their own role", async () => {
    db.table("roles").find((r) => r.id === ORDER_VIEWER)!.is_system_role = false;
    const res = await api().patch(`/api/admin/roles/${ORDER_VIEWER}/permissions`).set(auth(STAFF_ID)).send({ permissions: ["orders.view", "users.delete"] });
    expect(res.status).toBe(403);
  });

  it("an admin can't assign themselves (or anyone) a role stronger than their own", async () => {
    const self = await api().post(`/api/admin/users/${STAFF_ID}/roles`).set(auth(STAFF_ID)).send({ roleId: MANAGER });
    expect(self.status).toBe(403);
    const other = await api().post(`/api/admin/users/${ADMIN_ID}/roles`).set(auth(STAFF_ID)).send({ roleId: MANAGER });
    expect(other.status).toBe(403);
    expect(db.table("user_roles").some((r) => r.role_id === MANAGER)).toBe(false);
  });

  it("a super admin can grant any role", async () => {
    const res = await api().post(`/api/admin/users/${STAFF_ID}/roles`).set(auth(ADMIN_ID)).send({ roleId: MANAGER });
    expect(res.status).toBe(201);
  });
});
