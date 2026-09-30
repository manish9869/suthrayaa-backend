import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, auth, seed, ADMIN_ID, STAFF_ID, CUSTOMER_A, CUSTOMER_B, PRODUCT_ID } from "./helpers.js";
import { db } from "./db.js";
import { setGa4Transport, type GaTransport } from "../modules/analytics/ga4/client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Admin → Insights: store numbers from the database, visitor numbers from GA4 (faked here).

const range = "from=2026-03-01&to=2026-03-31";

function order(over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  const id = randomUUID();
  const total = (over.total as number) ?? 500;
  db.table("orders").push({
    id,
    order_number: `ORD-${id.slice(0, 6)}`,
    customer_id: CUSTOMER_A,
    guest_email: null,
    shipping_address: { firstName: "Priya", lastName: "Sharma", state: "Maharashtra", city: "Pune", email: "priya@example.com" },
    status: "confirmed",
    payment_status: "paid",
    payment_method: "razorpay",
    subtotal: total,
    discount_amount: 0,
    coupon_id: null,
    shipping_cost: 0,
    shipping_method: "standard",
    total,
    tax_amount: 0,
    refunded_amount: 0,
    placed_at: "2026-03-10T06:00:00.000Z",
    created_at: "2026-03-10T05:59:00.000Z",
    ...over,
  });
  db.table("order_items").push({ id: randomUUID(), order_id: id, product_id: PRODUCT_ID, product_name_snapshot: "Amigurumi Bunny", product_sku_snapshot: "SKU-1", quantity: 1, line_total: total, customizations: [], ...item });
  return id;
}

/** A fake GA4 that answers any report with small, predictable numbers. */
const SESSIONS_BY_EVENT: Record<string, number> = { session_start: 200, view_item: 120, add_to_cart: 40, view_cart: 30, begin_checkout: 20, add_shipping_info: 16, add_payment_info: 12, purchase: 8, add_to_wishlist: 6, search: 25, LCP: 50, exception: 3 };
const calls: any[] = [];
function fakeReport(req: any) {
  const named = (list: any[] | undefined, what: string) =>
    (list ?? []).map((x) => {
      if (typeof x?.name !== "string") throw new Error(`Invalid value at '${what}' — GA4 expects { name } objects`);
      return x.name as string;
    });
  const dims: string[] = named(req.dimensions, "dimensions");
  const metrics: string[] = named(req.metrics, "metrics");
  const values = (vals: Record<string, string>) =>
    metrics.map((m) => {
      if (m === "sessions" || m === "eventCount") return String(vals.eventName ? SESSIONS_BY_EVENT[vals.eventName] ?? 1 : 200);
      if (m === "eventValue") return String(vals.eventName === "LCP" ? 50 * 3000 : 0);
      if (m === "engagementRate" || m === "bounceRate") return "0.5";
      if (m === "activeUsers") return vals.newVsReturning === "returning" ? "30" : "160";
      return "10";
    });
  let combos: Record<string, string>[] = [{}];
  for (const d of dims) {
    const list =
      d === "eventName"
        ? req.dimensionFilter?.filter?.inListFilter?.values ?? req.dimensionFilter?.andGroup?.expressions.find((e: any) => e.filter?.fieldName === "eventName")?.filter?.inListFilter?.values ?? [req.dimensionFilter?.filter?.stringFilter?.value ?? "page_view"]
        : d === "deviceCategory"
          ? ["mobile", "desktop"]
          : d === "date"
            ? ["20260310"]
            : d === "newVsReturning"
              ? ["new", "returning"]
              : [`${d}-value`];
    combos = combos.flatMap((c) => list.map((v: string) => ({ ...c, [d]: v })));
  }
  const rows = dims.length ? combos.map((c) => ({ dimensionValues: dims.map((d) => ({ value: c[d] })), metricValues: values(c).map((value) => ({ value })) })) : [];
  const totals = [{ metricValues: values({}).map((value) => ({ value })) }];
  return { dimensionHeaders: dims.map((name) => ({ name })), metricHeaders: metrics.map((name) => ({ name })), rows, totals, rowCount: rows.length };
}
const fakeGa: GaTransport = {
  async post(path, body: any) {
    calls.push({ path, body });
    if (path === ":batchRunReports") return { reports: body.requests.map(fakeReport) };
    return fakeReport(body);
  },
};

const get = (section: string, query = range, as = ADMIN_ID) => api().get(`/api/admin/insights/${section}?${query}`).set(auth(as));
const kpis = (body: any) => Object.fromEntries(body.blocks.find((b: any) => b.type === "kpis").items.map((k: any) => [k.key, k]));

beforeEach(() => {
  seed();
  calls.length = 0;
});
afterEach(() => setGa4Transport(null));

describe("Insights without Google Analytics", () => {
  it("lists the sections and builds every one from store data alone", async () => {
    const list = await api().get("/api/admin/insights").set(auth(ADMIN_ID));
    expect(list.status).toBe(200);
    const ids = list.body.sections.map((s: any) => s.id);
    expect(ids).toEqual(["overview", "sales", "products", "customers", "funnel", "marketing", "search", "technology", "geography", "pages", "customization", "wishlist", "refunds", "realtime", "alerts"]);
    order();
    for (const id of ids) {
      const res = await get(id);
      expect(res.status, id).toBe(200);
      expect(res.body.blocks.length, id).toBeGreaterThan(0);
      expect(res.body.ga.configured).toBe(false);
    }
    const o = await get("overview");
    expect(o.body.blocks[0]).toMatchObject({ type: "notice", tone: "info" });
    expect(kpis(o.body).revenue.value).toBe(500);
    expect(kpis(o.body).users.value).toBeNull();
  });

  it("is for analytics viewers only, and rejects unknown sections", async () => {
    expect((await get("overview", range, STAFF_ID)).status).toBe(403);
    expect((await get("overview", range, CUSTOMER_A)).status).toBe(403);
    expect((await get("nope")).status).toBe(404);
    expect((await get("overview", "from=2026-03-10&to=2026-03-01")).status).toBe(400);
  });
});

describe("Insights with Google Analytics", () => {
  beforeEach(() => setGa4Transport(fakeGa));

  it("overview mixes store money with GA4 behaviour and compares periods", async () => {
    order();
    order({ customer_id: CUSTOMER_B, total: 300, placed_at: "2026-03-20T06:00:00.000Z" });
    order({ total: 1000, placed_at: "2026-02-10T06:00:00.000Z" }); // comparison period
    const res = await get("overview");
    expect(res.status).toBe(200);
    const k = kpis(res.body);
    expect(k.revenue).toMatchObject({ value: 800, previous: 1000, change: -20, source: "store" });
    expect(k.orders.value).toBe(2);
    expect(k.newCustomers.value).toBe(1); // customer B's first order
    expect(k.returningCustomers.value).toBe(1); // customer A ordered in February
    expect(k.users).toMatchObject({ value: 160, source: "ga4" });
    expect(k.conversion.value).toBe(4); // 8 purchase sessions / 200 sessions
    expect(k.addToCartRate.value).toBe(20);
    expect(k.checkoutConversion.value).toBe(40);
    expect(k.wishlistAdds.value).toBe(6);
    expect(k.revenuePerUser.value).toBe(5);
    expect(res.body.period).toMatchObject({ compareFrom: "2026-02-01", compareTo: "2026-02-28", granularity: "day" });
    const insights = res.body.blocks.find((b: any) => b.type === "insights");
    expect(insights.items.some((i: any) => /Revenue fell 20%/.test(i.text))).toBe(true);
    const revenue = res.body.blocks.find((b: any) => b.id === "revenue");
    expect(revenue.points).toHaveLength(31);
    expect(revenue.points[9].values.revenue).toBe(500);
    expect(revenue.points[9].previous.revenue).toBe(1000);
    // GA4 was asked for both periods
    const ranges = calls.flatMap((c) => c.body.requests?.map((r: any) => r.dateRanges[0].startDate) ?? []);
    expect(ranges).toContain("2026-03-01");
    expect(ranges).toContain("2026-02-01");
  });

  it("applies store filters to store numbers and visitor filters to GA4", async () => {
    order({ payment_method: "cod", total: 200 });
    order({ payment_method: "razorpay", total: 700 });
    const res = await get("overview", `${range}&payment=cod&device=mobile`);
    expect(kpis(res.body).revenue.value).toBe(200);
    expect(res.body.filterNotes.some((n: string) => n.startsWith("Payment method"))).toBe(true);
    expect(res.body.filterNotes.some((n: string) => n.startsWith("Device"))).toBe(true);
    const filters = calls.flatMap((c) => c.body.requests ?? []).map((r: any) => JSON.stringify(r.dimensionFilter ?? {}));
    expect(filters.every((f: string) => f.includes("deviceCategory"))).toBe(true);
  });

  it("builds every section with GA4 data", async () => {
    order({}, { customizations: [{ label: "Petals", valueLabel: "Pink" }] });
    for (const id of ["sales", "products", "customers", "funnel", "marketing", "search", "technology", "geography", "pages", "customization", "wishlist", "refunds", "realtime", "alerts"]) {
      const res = await get(id);
      expect(res.status, id).toBe(200);
      expect(res.body.ga, id).toMatchObject({ configured: true });
      expect(res.body.blocks.some((b: any) => b.type === "notice" && b.tone !== "info"), id).toBe(false);
    }
    const funnel = await get("funnel");
    const steps = funnel.body.blocks.find((b: any) => b.type === "funnel").steps;
    expect(steps.map((s: any) => s.value)).toEqual([200, 120, 40, 20, 16, 12, 8]);
    const custom = await get("customization");
    expect(kpis(custom.body).share.value).toBe(100);
    const rt = await get("realtime");
    expect(rt.body.refresh).toBe(30);
    expect(calls.some((c) => c.path === ":runRealtimeReport")).toBe(true);
  });

  it("raises alerts from the thresholds", async () => {
    order({ total: 100 });
    order({ total: 1000, placed_at: "2026-02-10T06:00:00.000Z" });
    const res = await get("alerts");
    const checks = res.body.blocks.find((b: any) => b.id === "checks").rows;
    expect(checks.find((c: any) => /Revenue drop/.test(c.check)).status).toBe("Alert");
    expect(checks.find((c: any) => /Checkout abandonment/.test(c.check)).status).toBe("OK"); // 60% < 80%
    db.table("site_settings").push({ key: "insights.alert_checkout_abandon_pct", value: 50 });
    const count = await api().get(`/api/admin/insights/alerts/count?${range}`).set(auth(ADMIN_ID));
    expect(count.body.count).toBeGreaterThanOrEqual(1);
  });

  it("keeps working when GA4 fails", async () => {
    setGa4Transport({
      async post() {
        throw new Error("quota exhausted");
      },
    });
    order();
    const res = await get("overview");
    expect(res.status).toBe(200);
    expect(res.body.ga).toMatchObject({ configured: true, connected: false });
    expect(res.body.blocks[0]).toMatchObject({ type: "notice", tone: "warning" });
    expect(kpis(res.body).revenue.value).toBe(500);
  });
});
