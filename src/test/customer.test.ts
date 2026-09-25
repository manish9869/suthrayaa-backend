import { beforeEach, describe, expect, it } from "vitest";
import { api, auth, seed, ADDRESS, CUSTOMER_A, CUSTOMER_B, PRODUCT_ID, HIDDEN_PRODUCT_ID } from "./helpers.js";
import { db } from "./db.js";

beforeEach(() => seed());

const addr = (over: Record<string, unknown> = {}) => {
  const { email: _email, ...a } = ADDRESS;
  return { ...a, ...over };
};

describe("profile", () => {
  it("updates name, phone and marketing preference", async () => {
    const res = await api().patch("/api/me").set(auth(CUSTOMER_A)).send({ firstName: "Priya", lastName: "Sharma", phone: "+91 98765 43210", marketingOptIn: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ firstName: "Priya", lastName: "Sharma", phone: "9876543210", marketingOptIn: true });
  });

  it("rejects an invalid mobile number and empty names", async () => {
    const phone = await api().patch("/api/me").set(auth(CUSTOMER_A)).send({ phone: "12345" });
    expect(phone.status).toBe(400);
    expect(phone.body.error.details.fieldErrors.phone).toBeTruthy();
    const name = await api().patch("/api/me").set(auth(CUSTOMER_A)).send({ firstName: "  " });
    expect(name.status).toBe(400);
  });

  it("ignores fields customers may not set (email, id)", async () => {
    await api().get("/api/me").set(auth(CUSTOMER_A, "a@example.com"));
    const res = await api().patch("/api/me").set(auth(CUSTOMER_A, "a@example.com")).send({ email: "evil@example.com", id: CUSTOMER_B, firstName: "A" });
    expect(res.status).toBe(200);
    expect(db.table("customer_profiles")[0]).toMatchObject({ id: CUSTOMER_A, email: "a@example.com" });
  });
});

describe("address book", () => {
  it("creates, lists, updates and deletes an address", async () => {
    const created = await api().post("/api/me/addresses").set(auth(CUSTOMER_A)).send(addr({ addressType: "home" }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ firstName: "Priya", isDefault: true, isDefaultBilling: true });

    const list = await api().get("/api/me/addresses").set(auth(CUSTOMER_A));
    expect(list.body).toHaveLength(1);

    const upd = await api().patch(`/api/me/addresses/${created.body.id}`).set(auth(CUSTOMER_A)).send({ city: "Mumbai" });
    expect(upd.body.city).toBe("Mumbai");

    const del = await api().delete(`/api/me/addresses/${created.body.id}`).set(auth(CUSTOMER_A));
    expect(del.status).toBe(204);
    expect((await api().get("/api/me/addresses").set(auth(CUSTOMER_A))).body).toHaveLength(0);
  });

  it("validates Indian address fields", async () => {
    const res = await api().post("/api/me/addresses").set(auth(CUSTOMER_A)).send(addr({ pincode: "12", phone: "1", state: "Atlantis", addressLine1: "" }));
    expect(res.status).toBe(400);
    const fe = res.body.error.details.fieldErrors;
    expect(Object.keys(fe)).toEqual(expect.arrayContaining(["pincode", "phone", "state", "addressLine1"]));
  });

  it("keeps exactly one default and promotes another when the default is deleted", async () => {
    const a = (await api().post("/api/me/addresses").set(auth(CUSTOMER_A)).send(addr())).body;
    const b = (await api().post("/api/me/addresses").set(auth(CUSTOMER_A)).send(addr({ city: "Nashik" }))).body;
    expect(b.isDefault).toBe(false);

    await api().patch(`/api/me/addresses/${b.id}`).set(auth(CUSTOMER_A)).send({ isDefault: true });
    let list = (await api().get("/api/me/addresses").set(auth(CUSTOMER_A))).body;
    expect(list.filter((x: { isDefault: boolean }) => x.isDefault).map((x: { id: string }) => x.id)).toEqual([b.id]);

    await api().delete(`/api/me/addresses/${b.id}`).set(auth(CUSTOMER_A));
    list = (await api().get("/api/me/addresses").set(auth(CUSTOMER_A))).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, isDefault: true });
  });

  it("never lets one customer read, change or delete another's address", async () => {
    const mine = (await api().post("/api/me/addresses").set(auth(CUSTOMER_A)).send(addr())).body;
    expect((await api().get("/api/me/addresses").set(auth(CUSTOMER_B))).body).toHaveLength(0);
    const upd = await api().patch(`/api/me/addresses/${mine.id}`).set(auth(CUSTOMER_B)).send({ city: "Hacked" });
    expect(upd.status).toBe(404);
    await api().delete(`/api/me/addresses/${mine.id}`).set(auth(CUSTOMER_B));
    expect(db.table("addresses").find((r) => r.id === mine.id)?.city).toBe("Pune");
  });

  it("treats malformed ids as not found (no database errors)", async () => {
    const res = await api().patch("/api/me/addresses/../../admin").set(auth(CUSTOMER_A)).send({ city: "x" });
    expect([404]).toContain(res.status);
    const res2 = await api().get("/api/me/orders/not-a-uuid").set(auth(CUSTOMER_A));
    expect(res2.status).toBe(404);
  });
});

describe("cart & wishlist", () => {
  it("merges quantities but caps a line at 20", async () => {
    const item = { productId: PRODUCT_ID, quantity: 15 };
    await api().put("/api/me/cart").set(auth(CUSTOMER_A)).send({ items: [item] });
    const res = await api().put("/api/me/cart").set(auth(CUSTOMER_A)).send({ items: [item] });
    expect(res.status).toBe(200);
    expect(db.table("cart_items")[0].quantity).toBe(20);
  });

  it("rejects invalid quantities and malformed product ids", async () => {
    for (const q of [0, -1, 21, 1.5]) {
      const res = await api().put("/api/me/cart").set(auth(CUSTOMER_A)).send({ items: [{ productId: PRODUCT_ID, quantity: q }] });
      expect(res.status).toBe(400);
    }
    const bad = await api().put("/api/me/cart").set(auth(CUSTOMER_A)).send({ items: [{ productId: "not-a-uuid", quantity: 1 }] });
    expect(bad.status).toBe(400);
  });

  it("requires sign-in and scopes cart items to their owner", async () => {
    expect((await api().get("/api/me/cart")).status).toBe(401);
    await api().put("/api/me/cart").set(auth(CUSTOMER_A)).send({ items: [{ productId: PRODUCT_ID, quantity: 1 }] });
    const lineId = db.table("cart_items")[0].id;
    await api().delete(`/api/me/cart/${lineId}`).set(auth(CUSTOMER_B));
    expect(db.table("cart_items")).toHaveLength(1);
    expect((await api().get("/api/me/cart").set(auth(CUSTOMER_B))).body).toHaveLength(0);
  });

  it("only wishlists products that exist", async () => {
    const res = await api().post("/api/me/wishlist/aaaaaaaa-0000-4000-8000-00000000abcd").set(auth(CUSTOMER_A));
    expect(res.status).toBe(404);
    const ok = await api().post(`/api/me/wishlist/${PRODUCT_ID}`).set(auth(CUSTOMER_A));
    expect(ok.status).toBe(204);
  });
});

describe("catalog", () => {
  it("never lists or serves archived products", async () => {
    const list = await api().get("/api/products");
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(HIDDEN_PRODUCT_ID);
    const one = await api().get("/api/products/product-3");
    expect(one.status).toBe(404);
  });

  it("returns 404 for an unknown product", async () => {
    expect((await api().get("/api/products/does-not-exist")).status).toBe(404);
  });
});
