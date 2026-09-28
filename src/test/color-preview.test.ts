import { beforeEach, describe, expect, it } from "vitest";
import { api, seed, placeCodOrder, CUSTOMER_A, SIZED_PRODUCT_ID, SIZE_GROUP_ID, SIZE_LARGE_ID } from "./helpers.js";
import { db } from "./db.js";

// Live color preview is an optional add-on: off by default, switchable store-wide, and it
// must never change catalog or checkout behaviour while off.

const PETAL_GROUP_ID = "bbbbbbbb-0000-4000-8000-0000000000c1";
const PINK_ID = "cccccccc-0000-4000-8000-0000000000c1";
const SLUG = `product-${SIZED_PRODUCT_ID.slice(-1)}`;

function seedWithPreview() {
  seed();
  const product = db.table("products").find((p: any) => p.id === SIZED_PRODUCT_ID) as any;
  Object.assign(product, { preview_mode: "svg", preview_svg_template: "flower-5-petal" });
  db.table("product_customizations").push({ id: PETAL_GROUP_ID, product_id: SIZED_PRODUCT_ID, name: "petal", label: "Petal color", type: "color", required: false, enabled: true, sort_order: 1 });
  db.table("customization_values").push({ id: PINK_ID, customization_id: PETAL_GROUP_ID, label: "Rose pink", value: "#ffc0cb", price_adjustment: 50, enabled: true, sort_order: 0 });
  db.table("product_preview_layers").push(
    { id: "ffffffff-0000-4000-8000-000000000001", product_id: SIZED_PRODUCT_ID, customization_id: PETAL_GROUP_ID, zone: "petals", sort_order: 0 },
    // linked to a non-color group — must be ignored
    { id: "ffffffff-0000-4000-8000-000000000002", product_id: SIZED_PRODUCT_ID, customization_id: SIZE_GROUP_ID, zone: "center", sort_order: 1 }
  );
}

const switchOn = () => db.table("site_settings").push({ key: "storefront.color_preview", value: true });

const items = [
  {
    productId: SIZED_PRODUCT_ID,
    quantity: 1,
    customizations: [
      { customizationId: SIZE_GROUP_ID, valueId: SIZE_LARGE_ID },
      { customizationId: PETAL_GROUP_ID, valueId: PINK_ID },
    ],
  },
];

beforeEach(() => seedWithPreview());

describe("storefront product preview", () => {
  it("is absent while the store-wide switch is off (the default)", async () => {
    const res = await api().get(`/api/products/${SLUG}`);
    expect(res.status).toBe(200);
    expect(res.body.preview).toBeUndefined();
  });

  it("appears once switched on, with only layers driven by color groups", async () => {
    switchOn();
    const res = await api().get(`/api/products/${SLUG}`);
    expect(res.body.preview).toMatchObject({ mode: "svg", svgTemplate: "flower-5-petal" });
    expect(res.body.preview.layers).toHaveLength(1);
    expect(res.body.preview.layers[0]).toMatchObject({ customizationId: PETAL_GROUP_ID, zone: "petals" });
  });

  it("is absent when the product's own mode is 'none'", async () => {
    switchOn();
    (db.table("products").find((p: any) => p.id === SIZED_PRODUCT_ID) as any).preview_mode = "none";
    const res = await api().get(`/api/products/${SLUG}`);
    expect(res.body.preview).toBeUndefined();
  });
});

describe("checkout with a preview", () => {
  it("charges every selection's price adjustment", async () => {
    switchOn();
    const res = await api().post("/api/checkout/validate-cart").send({ items });
    expect(res.body.error).toBeUndefined();
    expect(res.body.subtotal).toBe(800 + 100 + 50);
  });

  it("freezes what the customer saw onto the order line", async () => {
    switchOn();
    const res = await placeCodOrder(CUSTOMER_A, items);
    expect(res.status).toBeLessThan(300);
    const line = db.table("order_items")[0] as any;
    expect(line.preview_snapshot).toMatchObject({ mode: "svg", svgTemplate: "flower-5-petal" });
    expect(line.preview_snapshot.layers).toEqual([
      expect.objectContaining({ customizationId: PETAL_GROUP_ID, partLabel: "Petal color", zone: "petals", hex: "#ffc0cb", colorName: "Rose pink" }),
    ]);
  });

  it("writes order lines exactly as before when switched off", async () => {
    const res = await placeCodOrder(CUSTOMER_A, items);
    expect(res.status).toBeLessThan(300);
    const line = db.table("order_items")[0] as any;
    expect("preview_snapshot" in line).toBe(false);
    expect(line.customizations).toHaveLength(2);
  });
});
