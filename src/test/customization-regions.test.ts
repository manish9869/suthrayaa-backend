import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, auth, seed, placeCodOrder, ADMIN_ID, CUSTOMER_A, SIZED_PRODUCT_ID, SIZE_GROUP_ID, SIZE_LARGE_ID } from "./helpers.js";
import { db } from "./db.js";
import { invalidateLibraryColors } from "../modules/catalog/library-colors.js";

// Generic region configuration: arbitrary regions (masks), groups with shared or individual
// colours, allowed colours per region/group/product. Nothing here is product-specific — the
// scenarios below (a toran-like piece with repeated elements, a keychain) use the same engine.

const PID = SIZED_PRODUCT_ID;
const SLUG = `product-${PID.slice(-1)}`;
const url = (name: string) => `http://localhost:54321/storage/v1/object/public/product-images/${PID}/preview/${name}.webp`;
const put = (body: object) => api().put(`/api/admin/products/${PID}/preview/regions`).set(auth(ADMIN_ID)).send(body);
const storefront = () => api().get(`/api/products/${SLUG}`);

const C = {
  pink: { id: randomUUID(), name: "Pink", hex: "#FFB6C1" },
  yellow: { id: randomUUID(), name: "Yellow", hex: "#FFD700" },
  white: { id: randomUUID(), name: "White", hex: "#FFFFFF" },
  green: { id: randomUUID(), name: "Green", hex: "#228B22" },
  black: { id: randomUUID(), name: "Black", hex: "#111111" },
};

function region(name: string, extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), name, maskUrl: url(name.replace(/\s/g, "-")), changeable: true, ...extra };
}
const base = { baseUrl: url("base"), width: 800, height: 1000 };

function colourOptions(body: any) {
  return (body.customizations ?? []).filter((c: any) => c.type === "color");
}

beforeEach(() => {
  seed();
  Object.values(C).forEach((c, i) => db.table("colors").push({ ...c, sort_order: i, is_active: true }));
  db.table("site_settings").push({ key: "storefront.color_preview", value: true });
  invalidateLibraryColors();
});

describe("saving a region configuration", () => {
  it("gives each ungrouped changeable region its own option with every library colour", async () => {
    const a = region("Main Body", { hex: "#AA3322" });
    const b = region("Border");
    const res = await put({ ...base, groups: [], regions: [a, b] });
    expect(res.status).toBe(200);
    expect(res.body.layers.map((l: any) => l.name)).toEqual(["Main Body", "Border"]);

    const sf = await storefront();
    const opts = colourOptions(sf.body);
    expect(opts.map((o: any) => o.label)).toEqual(["Main Body", "Border"]);
    expect(opts[0].values).toHaveLength(5);
    expect(opts[0].defaultValue).toBe("#AA3322"); // the photo's own colour, shown as "Original"
    expect(sf.body.preview.layers.map((l: any) => l.customizationId)).toEqual(opts.map((o: any) => o.id));
  });

  it("paints every region of a shared group with ONE option (repeated elements)", async () => {
    const groupId = randomUUID();
    const flowers = [1, 2, 3, 4].map((i) => region(`Flower ${i}`, { groupId }));
    const res = await put({
      ...base,
      groups: [{ id: groupId, name: "Flowers", sharedColor: true, colorIds: [C.pink.id, C.yellow.id, C.white.id] }],
      regions: flowers,
    });
    expect(res.status).toBe(200);

    const sf = await storefront();
    const opts = colourOptions(sf.body);
    expect(opts).toHaveLength(1);
    expect(opts[0].label).toBe("Flowers");
    expect(opts[0].values.map((v: any) => v.label)).toEqual(["Pink", "Yellow", "White"]);
    const layers = sf.body.preview.layers;
    expect(layers).toHaveLength(4);
    expect(new Set(layers.map((l: any) => l.customizationId))).toEqual(new Set([opts[0].id]));
    expect(sf.body.preview.groups).toEqual([expect.objectContaining({ id: groupId, name: "Flowers", sharedColor: true })]);
  });

  it("gives each region of an individual group its own option", async () => {
    const groupId = randomUUID();
    const balls = [1, 2, 3].map((i) => region(`Ball ${i}`, { groupId }));
    await put({ ...base, groups: [{ id: groupId, name: "Decorative balls", sharedColor: false }], regions: balls });
    const sf = await storefront();
    expect(colourOptions(sf.body).map((o: any) => o.label)).toEqual(["Ball 1", "Ball 2", "Ball 3"]);
    expect(new Set(sf.body.preview.layers.map((l: any) => l.customizationId)).size).toBe(3);
    expect(sf.body.preview.groups[0]).toMatchObject({ name: "Decorative balls", sharedColor: false });
  });

  it("never recolours fixed regions or the background, but keeps them for the editor", async () => {
    const body = region("Main Body");
    const strings = region("Strings", { changeable: false });
    const res = await put({ ...base, backgroundMaskUrl: url("background"), groups: [], regions: [body, strings] });
    expect(res.body.layers.map((l: any) => l.regionType).sort()).toEqual(["background", "fixed", "region"]);

    const sf = await storefront();
    expect(sf.body.preview.layers.map((l: any) => l.name)).toEqual(["Main Body"]);
    expect(colourOptions(sf.body).map((o: any) => o.label)).toEqual(["Main Body"]);
  });

  it("inherits colours region → group → whole library, with overrides at each level", async () => {
    const groupId = randomUUID();
    const eyes = region("Eyes", { colorIds: [C.black.id] });
    const body = region("Body");
    const leaf = region("Leaf", { groupId });
    await put({ ...base, groups: [{ id: groupId, name: "Leaves", sharedColor: false, colorIds: [C.green.id, C.yellow.id] }], regions: [eyes, body, leaf] });

    const opts = colourOptions((await storefront()).body);
    const colours = (label: string) => opts.find((o: any) => o.label === label).values.map((v: any) => v.label);
    expect(colours("Eyes")).toEqual(["Black"]);
    expect(colours("Body")).toEqual(["Pink", "Yellow", "White", "Green", "Black"]); // whole library
    expect(colours("Leaf")).toEqual(["Yellow", "Green"]); // group's list, library order
  });

  it("updates options in place on re-save and switches removed colours off instead of deleting them", async () => {
    const a = region("Main Body");
    await put({ ...base, groups: [], regions: [a] });
    const before = colourOptions((await storefront()).body)[0];

    await put({ ...base, groups: [], regions: [{ ...a, name: "Body", colorIds: [C.pink.id] }] });
    const after = colourOptions((await storefront()).body)[0];
    expect(after.id).toBe(before.id); // carts pointing at it stay valid
    expect(after.label).toBe("Body");
    expect(after.values.map((v: any) => v.label)).toEqual(["Pink"]);
    const rows = db.table("customization_values").filter((v: any) => v.customization_id === before.id);
    expect(rows).toHaveLength(5);
    expect(rows.filter((v: any) => v.enabled)).toHaveLength(1);
  });

  it("removes options it created that are no longer used, and older ones on request", async () => {
    const a = region("A");
    const b = region("B");
    await put({ ...base, groups: [], regions: [a, b] });
    await put({ ...base, groups: [], regions: [a] });
    expect(colourOptions((await storefront()).body).map((o: any) => o.label)).toEqual(["A"]);

    db.table("product_customizations").push({ id: randomUUID(), product_id: PID, name: "old", label: "Old colour", type: "color", required: false, enabled: true, sort_order: 1 });
    await put({ ...base, groups: [], regions: [a] });
    expect(colourOptions((await storefront()).body).map((o: any) => o.label)).toContain("Old colour");
    await put({ ...base, groups: [], regions: [a], removeOtherColourOptions: true });
    expect(colourOptions((await storefront()).body).map((o: any) => o.label)).toEqual(["A"]);
  });

  it("keeps a region's existing colour option when moving to regions (carts stay valid)", async () => {
    const oldOption = randomUUID();
    db.table("product_customizations").push({ id: oldOption, product_id: PID, name: "colour_1_x", label: "Petals", type: "color", required: false, enabled: true, sort_order: 1 });
    db.table("customization_values").push({ id: randomUUID(), customization_id: oldOption, label: "Pink", value: "#FFB6C1", price_adjustment: 0, enabled: true, sort_order: 0 });
    const r = region("Petals");
    db.table("product_preview_layers").push({ id: r.id, product_id: PID, customization_id: oldOption, mask_url: r.maskUrl, sort_order: 0 });

    await put({ ...base, groups: [], regions: [r], removeOtherColourOptions: true });
    const opts = colourOptions((await storefront()).body);
    expect(opts.map((o: any) => o.id)).toEqual([oldOption]);
    expect(opts[0].values).toHaveLength(5);
  });

  it("supports 20+ regions and overlapping regions with their layer order", async () => {
    const regions = Array.from({ length: 24 }, (_, i) => region(`Part ${i + 1}`, { allowOverlap: i % 2 === 0 }));
    const res = await put({ ...base, groups: [], regions });
    expect(res.status).toBe(200);
    const layers = (await storefront()).body.preview.layers;
    expect(layers).toHaveLength(24);
    expect(layers.map((l: any) => l.sortOrder)).toEqual([...Array(24).keys()]);
    expect(layers[0].allowOverlap).toBe(true);
  });
});

describe("rejecting bad configurations", () => {
  it("rejects colours that aren't active in the library", async () => {
    const res = await put({ ...base, groups: [], regions: [region("A", { colorIds: [randomUUID()] })] });
    expect(res.status).toBe(400);
  });

  it("rejects images that aren't this product's own uploads", async () => {
    const res = await put({ ...base, groups: [], regions: [region("A", { maskUrl: "https://evil.example.com/x.png" })] });
    expect(res.status).toBe(400);
    const other = await put({ ...base, groups: [], regions: [region("A", { maskUrl: url("../../other-product/preview/x") })] });
    expect(other.status).toBe(400);
  });

  it("rejects a configuration with nothing changeable, and regions in unknown groups", async () => {
    expect((await put({ ...base, groups: [], regions: [region("A", { changeable: false })] })).status).toBe(400);
    expect((await put({ ...base, groups: [], regions: [region("A", { groupId: randomUUID() })] })).status).toBe(400);
  });

  it("refuses region ids that belong to another product", async () => {
    const foreign = randomUUID();
    db.table("product_preview_layers").push({ id: foreign, product_id: randomUUID(), mask_url: "x", sort_order: 0 });
    const res = await put({ ...base, groups: [], regions: [{ ...region("A"), id: foreign }] });
    expect(res.status).toBe(400);
    expect(db.table("product_preview_layers").find((l: any) => l.id === foreign)).toMatchObject({ mask_url: "x" });
  });

  it("keeps existing regions if writing the new ones fails", async () => {
    const a = region("A");
    await put({ ...base, groups: [], regions: [a] });
    const before = db.table("product_preview_layers").filter((l: any) => l.product_id === PID).length;
    const bad = await put({ ...base, groups: [], regions: [a, { ...region("B"), colorIds: [randomUUID()] }] });
    expect(bad.status).toBe(400);
    expect(db.table("product_preview_layers").filter((l: any) => l.product_id === PID)).toHaveLength(before);
  });

  it("is admin-only", async () => {
    const res = await api().put(`/api/admin/products/${PID}/preview/regions`).set(auth(CUSTOMER_A)).send({ ...base, groups: [], regions: [region("A")] });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it("keeps regions when the preview is switched off through the older save", async () => {
    await put({ ...base, groups: [], regions: [region("A")] });
    await api().put(`/api/admin/products/${PID}/preview`).set(auth(ADMIN_ID)).send({ mode: "none", layers: [] });
    expect(db.table("product_preview_layers").filter((l: any) => l.product_id === PID)).toHaveLength(1);
  });
});

describe("customers and orders", () => {
  it("validates choices server-side and freezes region names into the order", async () => {
    const groupId = randomUUID();
    await put({
      ...base,
      groups: [{ id: groupId, name: "Flowers", sharedColor: true, colorIds: [C.pink.id, C.yellow.id] }],
      regions: [region("Flower 1", { groupId }), region("Flower 2", { groupId }), region("Border", { colorIds: [C.black.id] })],
    });
    const opts = colourOptions((await storefront()).body);
    const flowers = opts.find((o: any) => o.label === "Flowers");
    const border = opts.find((o: any) => o.label === "Border");
    const pink = flowers.values.find((v: any) => v.label === "Pink");

    // a colour that isn't allowed for this option can't be injected
    const blackForFlowers = db.table("customization_values").find((v: any) => v.customization_id === border.id);
    const bad = await api()
      .post("/api/checkout/validate-cart")
      .send({ items: [{ productId: PID, quantity: 1, customizations: [{ customizationId: SIZE_GROUP_ID, valueId: SIZE_LARGE_ID }, { customizationId: flowers.id, valueId: (blackForFlowers as any).id }] }] });
    expect(bad.status).toBe(400);

    const res = await placeCodOrder(CUSTOMER_A, [
      { productId: PID, quantity: 1, customizations: [{ customizationId: SIZE_GROUP_ID, valueId: SIZE_LARGE_ID }, { customizationId: flowers.id, valueId: pink.id }] },
    ] as any);
    expect(res.status).toBeLessThan(300);
    const line = db.table("order_items")[0] as any;
    expect(line.customizations).toContainEqual(expect.objectContaining({ label: "Flowers", valueLabel: "Pink", value: "#FFB6C1" }));
    const snap = line.preview_snapshot.layers;
    expect(snap.filter((l: any) => l.groupName === "Flowers").map((l: any) => [l.regionName, l.colorName])).toEqual([
      ["Flower 1", "Pink"],
      ["Flower 2", "Pink"],
    ]);

    // later edits never change the placed order
    await put({ ...base, groups: [], regions: [region("Something else")] });
    expect((db.table("order_items")[0] as any).preview_snapshot.layers[0].regionName).toBe("Flower 1");
  });
});
