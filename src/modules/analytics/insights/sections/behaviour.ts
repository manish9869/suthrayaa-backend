import { couponBreakdown, isCollected, paymentAttempts } from "../../analytics.service.js";
import { dimIs, eventIn, gaBucketDim, gaSeries, rowSum, total } from "../ga.js";
import type { GaReport, GaRow } from "../../ga4/client.js";
import { kpi, pct, round2, shares, type Block, type Column, type Row } from "../types.js";
import { gaNotice, mergeSeries, safeDiv, seriesBlock, titleCase, type SectionCtx, type SectionDef } from "./common.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: unknown) => Number(v ?? 0);
const notSet = (v: unknown) => !v || v === "(not set)";

/** Standard traffic table columns (users, sessions, engagement, purchases, GA revenue, conversion). */
const TRAFFIC_METRICS = ["activeUsers", "sessions", "engagementRate", "ecommercePurchases", "purchaseRevenue"];
function trafficRows(r: GaReport | undefined, dim: string, prev?: GaReport, label: (v: string) => string = (v) => v): Row[] {
  const before = new Map((prev?.rows ?? []).map((x) => [String(x[dim]), num(x.sessions)]));
  return (r?.rows ?? []).map((x: GaRow) => ({
    name: label(String(x[dim])),
    users: num(x.activeUsers),
    sessions: num(x.sessions),
    change: before.has(String(x[dim])) ? round2(((num(x.sessions) - before.get(String(x[dim]))!) / Math.max(1, before.get(String(x[dim]))!)) * 100) : null,
    engagement: round2(num(x.engagementRate) * 100),
    purchases: num(x.ecommercePurchases),
    conversion: pct(num(x.ecommercePurchases), num(x.sessions)),
    revenue: round2(num(x.purchaseRevenue)),
  }));
}
const trafficColumns = (first: string): Column[] => [
  { key: "name", label: first },
  { key: "users", label: "Users", format: "number", align: "right" },
  { key: "sessions", label: "Sessions", format: "number", align: "right" },
  { key: "change", label: "Sessions vs before", format: "percent", align: "right" },
  { key: "engagement", label: "Engaged", format: "percent", align: "right" },
  { key: "purchases", label: "Purchases", format: "number", align: "right" },
  { key: "conversion", label: "Conversion", format: "percent", align: "right" },
  { key: "revenue", label: "Revenue (GA)", format: "money", align: "right" },
];
const trafficTable = (id: string, title: string, first: string, rows: Row[], description?: string, ctx?: SectionCtx): Block => ({
  type: "table",
  id,
  title,
  description,
  source: "ga4",
  columns: trafficColumns(first),
  rows,
  empty: ctx && !ctx.ga.configured ? "Needs Google Analytics." : "No data for this period.",
});
const sortedReq = (dims: string[], limit = 100) => ({ dimensions: dims, metrics: TRAFFIC_METRICS, limit, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] });

// ---------------------------------------------------------------- Shopping funnel, cart & checkout

const STEPS: [string, string][] = [
  ["session_start", "Visited the shop"],
  ["view_item", "Viewed a product"],
  ["add_to_cart", "Added to cart"],
  ["begin_checkout", "Started checkout"],
  ["add_shipping_info", "Entered delivery details"],
  ["add_payment_info", "Chose payment"],
  ["purchase", "Purchased"],
];

export const funnel: SectionDef = {
  id: "funnel",
  title: "Shopping funnel",
  uses: { store: true, ga: true },
  async build(ctx) {
    const { period: p } = ctx;
    const names = [...STEPS.map((s) => s[0]), "view_cart", "remove_from_cart"];
    const [ga, attempts, prevAttempts] = await Promise.all([
      ctx.ga.pair([
        { dimensions: ["eventName"], metrics: ["sessions", "eventCount"], dimensionFilter: eventIn(names) },
        { dimensions: ["deviceCategory", "eventName"], metrics: ["sessions"], dimensionFilter: eventIn(["session_start", "add_to_cart", "begin_checkout", "purchase"]) },
        { dimensions: [gaBucketDim(p.granularity), "eventName"], metrics: ["sessions"], dimensionFilter: eventIn(["add_to_cart", "begin_checkout", "purchase"]), limit: 1200 },
      ]),
      paymentAttempts({ since: p.since, until: p.until }),
      p.compareSince && p.compareUntil ? paymentAttempts({ since: p.compareSince, until: p.compareUntil }) : Promise.resolve(null),
    ]);
    const s = (w: "cur" | "prev", name: string, m = "sessions") => (ga?.[w] ? rowSum(ga[w]![0], "eventName", name, m) : null);
    const rate = (w: "cur" | "prev", a: string, b: string) => safeDiv(s(w, a), s(w, b), 100);
    const abandon = (w: "cur" | "prev", a: string, b: string) => {
      const r = rate(w, a, b);
      return r === null ? null : round2(100 - r);
    };
    const devRows = new Map<string, Record<string, number>>();
    for (const r of ga?.cur[1]?.rows ?? []) {
      const e = devRows.get(String(r.deviceCategory)) ?? {};
      e[String(r.eventName)] = num(r.sessions);
      devRows.set(String(r.deviceCategory), e);
    }
    const bucket = gaBucketDim(p.granularity);
    const rateSeries = (w: "cur" | "prev", from: string, to: string) => {
      const agg = new Map<string, Record<string, string | number>>();
      for (const r of ga?.[w]?.[2]?.rows ?? []) {
        const e = agg.get(String(r[bucket])) ?? { [bucket]: String(r[bucket]) };
        e[String(r.eventName)] = num(r.sessions);
        agg.set(String(r[bucket]), e);
      }
      for (const e of agg.values()) {
        e.cartToCheckout = pct(num(e.begin_checkout), num(e.add_to_cart)) ?? 0;
        e.checkoutToPurchase = pct(num(e.purchase), num(e.begin_checkout)) ?? 0;
      }
      return gaSeries(ga?.[w] ? { rows: [...agg.values()], totals: {}, rowCount: agg.size } : undefined, from, to, p.granularity, ["cartToCheckout", "checkoutToPurchase"]);
    };
    const failed = attempts.byStatus.find((x) => x.status === "failed")?.count ?? 0;
    const pending = attempts.byStatus.find((x) => x.status === "pending")?.count ?? 0;

    return [
      ...gaNotice(ctx),
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("atcRate", "Add-to-cart rate", rate("cur", "add_to_cart", "session_start"), rate("prev", "add_to_cart", "session_start"), "percent", "ga4"),
          kpi("cartAbandon", "Cart abandonment", abandon("cur", "purchase", "add_to_cart"), abandon("prev", "purchase", "add_to_cart"), "percent", "ga4", { goodWhenUp: false, hint: "Sessions that added to cart but didn't buy" }),
          kpi("checkoutStart", "Cart → checkout", rate("cur", "begin_checkout", "add_to_cart"), rate("prev", "begin_checkout", "add_to_cart"), "percent", "ga4"),
          kpi("checkoutConv", "Checkout conversion", rate("cur", "purchase", "begin_checkout"), rate("prev", "purchase", "begin_checkout"), "percent", "ga4"),
          kpi("checkoutAbandon", "Checkout abandonment", abandon("cur", "purchase", "begin_checkout"), abandon("prev", "purchase", "begin_checkout"), "percent", "ga4", { goodWhenUp: false }),
          kpi("cartViews", "Cart views", s("cur", "view_cart", "eventCount"), s("prev", "view_cart", "eventCount"), "number", "ga4"),
          kpi("removals", "Removed from cart", s("cur", "remove_from_cart", "eventCount"), s("prev", "remove_from_cart", "eventCount"), "number", "ga4", { goodWhenUp: false }),
          kpi("paySuccess", "Online payment success", round2(attempts.successRatePct), prevAttempts ? round2(prevAttempts.successRatePct) : null, "percent", "store", { hint: "Orders paid ÷ checkouts that reached payment (from your orders)" }),
          kpi("payFailed", "Failed payments", failed, prevAttempts?.byStatus.find((x) => x.status === "failed")?.count ?? null, "number", "store", { goodWhenUp: false }),
          kpi("payPending", "Unfinished payments", pending, prevAttempts?.byStatus.find((x) => x.status === "pending")?.count ?? null, "number", "store", { goodWhenUp: false, hint: "Checkouts that reached payment and stopped (includes COD waiting for delivery)" }),
        ],
      },
      {
        type: "funnel",
        id: "funnel",
        title: "From visit to purchase",
        description: "Sessions that reached each step (Google Analytics). The drop between steps is where shoppers leave.",
        source: "ga4",
        steps: STEPS.map(([name, label]) => ({ label, value: s("cur", name) ?? 0, previous: s("prev", name) })),
      },
      seriesBlock(
        "rates",
        "Checkout progress over time",
        [
          { key: "cartToCheckout", label: "Cart → checkout", format: "percent", source: "ga4" },
          { key: "checkoutToPurchase", label: "Checkout → purchase", format: "percent", source: "ga4" },
        ],
        mergeSeries(rateSeries("cur", p.from, p.to), ga?.prev && p.compareFrom && p.compareTo ? rateSeries("prev", p.compareFrom, p.compareTo) : null)
      ),
      {
        type: "table",
        id: "byDevice",
        title: "Funnel by device",
        source: "ga4",
        columns: [
          { key: "device", label: "Device" },
          { key: "sessions", label: "Sessions", format: "number", align: "right" },
          { key: "atc", label: "Add to cart", format: "percent", align: "right" },
          { key: "checkout", label: "Checkout", format: "percent", align: "right" },
          { key: "purchase", label: "Purchase", format: "percent", align: "right" },
          { key: "checkoutConv", label: "Checkout → purchase", format: "percent", align: "right" },
        ],
        rows: [...devRows].map(([device, e]) => ({
          device: titleCase(device),
          sessions: e.session_start ?? 0,
          atc: pct(e.add_to_cart ?? 0, e.session_start ?? 0),
          checkout: pct(e.begin_checkout ?? 0, e.session_start ?? 0),
          purchase: pct(e.purchase ?? 0, e.session_start ?? 0),
          checkoutConv: pct(e.purchase ?? 0, e.begin_checkout ?? 0),
        })),
        empty: ctx.ga.configured ? "No data for this period." : "Needs Google Analytics.",
      },
      {
        type: "breakdown",
        id: "payments",
        title: "Payment attempts by result",
        description: "Every order that reached the payment step (from your orders).",
        format: "number",
        source: "store",
        items: shares(attempts.byStatus.filter((x) => x.count).map((x) => ({ label: x.status === "pending" ? "Not finished / COD" : titleCase(x.status), value: x.count }))),
      },
    ];
  },
};

// ---------------------------------------------------------------- Marketing: channels, campaigns, landing pages, promotions, coupons

export const marketing: SectionDef = {
  id: "marketing",
  title: "Marketing & campaigns",
  uses: { store: true, ga: true },
  async build(ctx) {
    const [store, ga, promos] = await Promise.all([
      ctx.store(),
      ctx.ga.pair([
        sortedReq(["sessionDefaultChannelGroup"], 25),
        sortedReq(["sessionSource", "sessionMedium"], 100),
        sortedReq(["sessionCampaignName"], 100),
        sortedReq(["landingPagePlusQueryString"], 100),
        { metrics: ["sessions", "newUsers", "ecommercePurchases", "purchaseRevenue"] },
      ]),
      ctx.ga.pair([{ dimensions: ["itemPromotionName"], metrics: ["itemsViewedInPromotion", "itemsClickedInPromotion"], limit: 50 }], "item"),
    ]);
    const coupons = couponBreakdown(store.cur.orders);
    const prevCoupons = store.prev ? couponBreakdown(store.prev.orders) : null;
    const couponOrders = coupons.reduce((a, c) => a + c.orders, 0);
    const t = (w: "cur" | "prev", m: string) => (ga?.[w] ? total(ga[w]![4], m) : null);
    return [
      ...gaNotice(ctx),
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("sessions", "Visits", t("cur", "sessions"), t("prev", "sessions"), "number", "ga4"),
          kpi("newUsers", "New visitors", t("cur", "newUsers"), t("prev", "newUsers"), "number", "ga4"),
          kpi("gaPurchases", "Purchases tracked", t("cur", "ecommercePurchases"), t("prev", "ecommercePurchases"), "number", "ga4"),
          kpi("discounts", "Coupon discounts", round2(coupons.reduce((a, c) => a + c.discount, 0)), prevCoupons ? round2(prevCoupons.reduce((a, c) => a + c.discount, 0)) : null, "money", "store"),
          kpi("couponShare", "Orders using a coupon", pct(couponOrders, store.cur.totals.paidOrders), null, "percent", "store"),
          kpi("couponSales", "Sales with a coupon", round2(coupons.reduce((a, c) => a + c.sales, 0)), prevCoupons ? round2(prevCoupons.reduce((a, c) => a + c.sales, 0)) : null, "money", "store"),
        ],
      },
      {
        type: "breakdown",
        id: "channels",
        title: "Visits by channel",
        format: "number",
        source: "ga4",
        items: shares((ga?.cur[0]?.rows ?? []).map((r) => ({ label: String(r.sessionDefaultChannelGroup), value: num(r.sessions) }))),
      },
      trafficTable("channelsTable", "Channels", "Channel", trafficRows(ga?.cur[0], "sessionDefaultChannelGroup", ga?.prev?.[0]), "Revenue here is what Google Analytics attributes to each channel.", ctx),
      trafficTable(
        "sources",
        "Sources / medium",
        "Source / medium",
        trafficRows(
          ga?.cur[1] ? { ...ga.cur[1], rows: ga.cur[1].rows.map((r) => ({ ...r, sm: `${r.sessionSource} / ${r.sessionMedium}` })) } : undefined,
          "sm",
          ga?.prev?.[1] ? { ...ga.prev[1], rows: ga.prev[1].rows.map((r) => ({ ...r, sm: `${r.sessionSource} / ${r.sessionMedium}` })) } : undefined
        ),
        undefined,
        ctx
      ),
      trafficTable(
        "campaigns",
        "Campaigns",
        "Campaign",
        trafficRows(ga?.cur[2] ? { ...ga.cur[2], rows: ga.cur[2].rows.filter((r) => !notSet(r.sessionCampaignName) && r.sessionCampaignName !== "(direct)" && r.sessionCampaignName !== "(organic)" && r.sessionCampaignName !== "(referral)") } : undefined, "sessionCampaignName", ga?.prev?.[2]),
        "Tag your links with utm_campaign (e.g. ?utm_source=instagram&utm_medium=social&utm_campaign=diwali) to see them here.",
        ctx
      ),
      trafficTable("landing", "Landing pages", "First page seen", trafficRows(ga?.cur[3], "landingPagePlusQueryString", ga?.prev?.[3]), undefined, ctx),
      {
        type: "table",
        id: "promotions",
        title: "Promotions (homepage banners)",
        description: "How often each banner was seen and clicked.",
        source: "ga4",
        columns: [
          { key: "name", label: "Promotion" },
          { key: "views", label: "Seen", format: "number", align: "right" },
          { key: "clicks", label: "Clicked", format: "number", align: "right" },
          { key: "ctr", label: "Click rate", format: "percent", align: "right" },
        ],
        rows: (promos?.cur[0]?.rows ?? [])
          .filter((r) => !notSet(r.itemPromotionName))
          .map((r) => ({ name: String(r.itemPromotionName), views: num(r.itemsViewedInPromotion), clicks: num(r.itemsClickedInPromotion), ctr: pct(num(r.itemsClickedInPromotion), num(r.itemsViewedInPromotion)) }))
          .sort((a, b) => b.views - a.views),
        empty: ctx.ga.configured ? "No banner views recorded yet." : "Needs Google Analytics.",
      },
      {
        type: "table",
        id: "coupons",
        title: "Coupons",
        source: "store",
        columns: [
          { key: "code", label: "Code" },
          { key: "orders", label: "Orders", format: "number", align: "right" },
          { key: "sales", label: "Sales", format: "money", align: "right" },
          { key: "discount", label: "Discount given", format: "money", align: "right" },
          { key: "avgDiscount", label: "Avg discount", format: "money", align: "right" },
        ],
        rows: coupons,
        empty: "No coupons used in this period.",
      },
    ];
  },
};

// ---------------------------------------------------------------- Site search

export const search: SectionDef = {
  id: "search",
  title: "Site search",
  uses: { store: false, ga: true },
  async build(ctx) {
    const { period: p } = ctx;
    const ga = await ctx.ga.pair([
      { dimensions: ["eventName"], metrics: ["eventCount", "activeUsers"], dimensionFilter: eventIn(["search", "search_no_results"]) },
      { dimensions: ["searchTerm"], metrics: ["eventCount", "activeUsers"], dimensionFilter: dimIs("eventName", "search"), limit: 200, orderBys: [{ metric: { metricName: "eventCount" }, desc: true }] },
      { dimensions: ["searchTerm"], metrics: ["eventCount"], dimensionFilter: dimIs("eventName", "search_no_results"), limit: 100, orderBys: [{ metric: { metricName: "eventCount" }, desc: true }] },
      { dimensions: [gaBucketDim(p.granularity)], metrics: ["eventCount"], dimensionFilter: dimIs("eventName", "search"), limit: 400 },
    ]);
    const e = (w: "cur" | "prev", name: string, m: string) => (ga?.[w] ? rowSum(ga[w]![0], "eventName", name, m) : null);
    return [
      ...gaNotice(ctx),
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("searches", "Searches", e("cur", "search", "eventCount"), e("prev", "search", "eventCount"), "number", "ga4"),
          kpi("searchers", "People searching", e("cur", "search", "activeUsers"), e("prev", "search", "activeUsers"), "number", "ga4"),
          kpi("perUser", "Searches per person", safeDiv(e("cur", "search", "eventCount"), e("cur", "search", "activeUsers")), safeDiv(e("prev", "search", "eventCount"), e("prev", "search", "activeUsers")), "decimal", "ga4"),
          kpi("noResults", "Searches with no results", e("cur", "search_no_results", "eventCount"), e("prev", "search_no_results", "eventCount"), "number", "ga4", { goodWhenUp: false }),
          kpi("noResultRate", "No-result rate", pct(e("cur", "search_no_results", "eventCount") ?? 0, e("cur", "search", "eventCount") ?? 0), ga?.prev ? pct(e("prev", "search_no_results", "eventCount") ?? 0, e("prev", "search", "eventCount") ?? 0) : null, "percent", "ga4", { goodWhenUp: false }),
        ],
      },
      seriesBlock(
        "searches",
        "Searches over time",
        [{ key: "eventCount", label: "Searches", format: "number", source: "ga4" }],
        mergeSeries(gaSeries(ga?.cur[3], p.from, p.to, p.granularity, ["eventCount"]), ga?.prev && p.compareFrom && p.compareTo ? gaSeries(ga.prev[3], p.compareFrom, p.compareTo, p.granularity, ["eventCount"]) : null),
        { chart: "bar" }
      ),
      {
        type: "table",
        id: "terms",
        title: "What people search for",
        source: "ga4",
        columns: [
          { key: "term", label: "Search term" },
          { key: "searches", label: "Searches", format: "number", align: "right" },
          { key: "people", label: "People", format: "number", align: "right" },
        ],
        rows: (ga?.cur[1]?.rows ?? []).filter((r) => !notSet(r.searchTerm)).map((r) => ({ term: String(r.searchTerm), searches: num(r.eventCount), people: num(r.activeUsers) })),
        empty: ctx.ga.configured ? "No searches in this period." : "Needs Google Analytics.",
      },
      {
        type: "table",
        id: "noResults",
        title: "Searches that found nothing",
        description: "Ideas for new products, or words to add to product names and descriptions.",
        source: "ga4",
        columns: [
          { key: "term", label: "Search term" },
          { key: "searches", label: "Searches", format: "number", align: "right" },
        ],
        rows: (ga?.cur[2]?.rows ?? []).filter((r) => !notSet(r.searchTerm)).map((r) => ({ term: String(r.searchTerm), searches: num(r.eventCount) })),
        empty: ctx.ga.configured ? "Every search found something (or terms aren't reported yet)." : "Needs Google Analytics.",
      },
    ];
  },
};

// ---------------------------------------------------------------- Devices, browsers & operating systems

export const technology: SectionDef = {
  id: "technology",
  title: "Devices & technology",
  uses: { store: false, ga: true },
  async build(ctx) {
    const ga = await ctx.ga.pair([sortedReq(["deviceCategory"], 10), sortedReq(["operatingSystem"], 30), sortedReq(["browser"], 30), sortedReq(["screenResolution"], 30), sortedReq(["deviceCategory", "operatingSystem"], 40)]);
    const dev = ga?.cur[0];
    return [
      ...gaNotice(ctx),
      { type: "breakdown", id: "devices", title: "Visits by device", format: "number", source: "ga4", items: shares((dev?.rows ?? []).map((r) => ({ label: titleCase(String(r.deviceCategory)), value: num(r.sessions) }))) },
      {
        type: "breakdown",
        id: "deviceRevenue",
        title: "Purchases by device",
        format: "number",
        source: "ga4",
        items: shares((dev?.rows ?? []).map((r) => ({ label: titleCase(String(r.deviceCategory)), value: num(r.ecommercePurchases) }))),
      },
      trafficTable("deviceTable", "Devices", "Device", trafficRows(dev, "deviceCategory", ga?.prev?.[0], titleCase), undefined, ctx),
      trafficTable("os", "Operating systems", "Operating system", trafficRows(ga?.cur[1], "operatingSystem", ga?.prev?.[1]), undefined, ctx),
      trafficTable("browsers", "Browsers", "Browser", trafficRows(ga?.cur[2], "browser", ga?.prev?.[2]), undefined, ctx),
      trafficTable(
        "deviceOs",
        "Device + operating system",
        "Device / OS",
        trafficRows(ga?.cur[4] ? { ...ga.cur[4], rows: ga.cur[4].rows.map((r) => ({ ...r, k: `${titleCase(String(r.deviceCategory))} · ${r.operatingSystem}` })) } : undefined, "k"),
        "Look for a combination with visits but no purchases — often a checkout problem on that phone.",
        ctx
      ),
      trafficTable("screens", "Screen sizes", "Screen resolution", trafficRows(ga?.cur[3], "screenResolution", ga?.prev?.[3]), undefined, ctx),
    ];
  },
};

// ---------------------------------------------------------------- Geography

export const geography: SectionDef = {
  id: "geography",
  title: "Geography",
  uses: { store: true, ga: true },
  async build(ctx) {
    const [store, ga] = await Promise.all([ctx.store(), ctx.ga.pair([sortedReq(["country"], 50), sortedReq(["region"], 60), sortedReq(["city"], 100)])]);
    const place = (key: "state" | "city") => {
      const m = new Map<string, { orders: number; revenue: number; customers: Set<string> }>();
      for (const o of store.cur.orders) {
        const a = o.shipping_address ?? {};
        const name = (key === "city" ? [a.city, a.state].filter(Boolean).join(", ") : a.state)?.trim() || "Unknown";
        const e = m.get(name) ?? { orders: 0, revenue: 0, customers: new Set<string>() };
        e.orders += 1;
        if (isCollected(o)) e.revenue += num(o.total) - num(o.refunded_amount);
        e.customers.add(o.customer_id ?? o.guest_email ?? o.id);
        m.set(name, e);
      }
      const all = [...m.values()].reduce((s, e) => s + e.revenue, 0);
      return [...m]
        .map(([name, e]) => ({ name, orders: e.orders, customers: e.customers.size, revenue: round2(e.revenue), share: pct(e.revenue, all), aov: e.orders ? round2(e.revenue / e.orders) : null }))
        .sort((a, b) => b.revenue - a.revenue);
    };
    const states = place("state");
    const storeCols: Column[] = [
      { key: "name", label: "Place" },
      { key: "orders", label: "Orders", format: "number", align: "right" },
      { key: "customers", label: "Customers", format: "number", align: "right" },
      { key: "revenue", label: "Revenue", format: "money", align: "right" },
      { key: "share", label: "Share", format: "percent", align: "right" },
      { key: "aov", label: "Avg order", format: "money", align: "right" },
    ];
    return [
      ...gaNotice(ctx),
      { type: "breakdown", id: "stateRevenue", title: "Revenue by state (orders)", format: "money", source: "store", items: shares(states.slice(0, 12).map((s) => ({ label: s.name, value: s.revenue }))) },
      { type: "breakdown", id: "regionVisits", title: "Visits by state / region", format: "number", source: "ga4", items: shares((ga?.cur[1]?.rows ?? []).slice(0, 12).map((r) => ({ label: String(r.region), value: num(r.sessions) }))) },
      { type: "table", id: "states", title: "States — orders", description: "From delivery addresses.", source: "store", columns: storeCols, rows: states },
      { type: "table", id: "cities", title: "Cities — orders", source: "store", columns: storeCols, rows: place("city").slice(0, 100) },
      trafficTable("countries", "Countries — visitors", "Country", trafficRows(ga?.cur[0], "country", ga?.prev?.[0]), undefined, ctx),
      trafficTable("regions", "States / regions — visitors", "Region", trafficRows(ga?.cur[1], "region", ga?.prev?.[1]), undefined, ctx),
      trafficTable("gaCities", "Cities — visitors", "City", trafficRows(ga?.cur[2], "city", ga?.prev?.[2]), undefined, ctx),
    ];
  },
};

// ---------------------------------------------------------------- Pages & technical performance

const VITALS: [string, string, number, number][] = [
  // name, label, good ≤, poor >   (ms, CLS ×1000)
  ["LCP", "Largest content shown (LCP)", 2500, 4000],
  ["INP", "Response to taps (INP)", 200, 500],
  ["CLS", "Layout shift (CLS)", 100, 250],
  ["FCP", "First content shown (FCP)", 1800, 3000],
  ["TTFB", "Server response (TTFB)", 800, 1800],
];

export const pages: SectionDef = {
  id: "pages",
  title: "Pages & site speed",
  uses: { store: false, ga: true },
  async build(ctx) {
    const vitalNames = VITALS.map((v) => v[0]);
    const ga = await ctx.ga.pair([
      { dimensions: ["pagePath"], metrics: ["screenPageViews", "activeUsers", "userEngagementDuration", "keyEvents"], limit: 200, orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }] },
      { dimensions: ["eventName"], metrics: ["eventValue", "eventCount"], dimensionFilter: eventIn([...vitalNames, "exception"]) },
      { dimensions: ["deviceCategory", "eventName"], metrics: ["eventValue", "eventCount"], dimensionFilter: eventIn(vitalNames) },
      { dimensions: ["pagePath", "eventName"], metrics: ["eventValue", "eventCount"], dimensionFilter: eventIn(["LCP", "INP"]), limit: 400 },
      { dimensions: ["pagePath"], metrics: ["eventCount"], dimensionFilter: dimIs("eventName", "exception"), limit: 50, orderBys: [{ metric: { metricName: "eventCount" }, desc: true }] },
      { dimensions: ["pagePath"], metrics: ["screenPageViews"], dimensionFilter: { filter: { fieldName: "pageTitle", stringFilter: { value: "Page not found", matchType: "BEGINS_WITH" } } }, limit: 50 },
      { metrics: ["screenPageViews", "screenPageViewsPerSession", "averageSessionDuration", "bounceRate", "engagementRate"] },
    ]);
    const avg = (r: GaReport | undefined, filterFn: (row: GaRow) => boolean) => {
      const rows = (r?.rows ?? []).filter(filterFn);
      const count = rows.reduce((s, x) => s + num(x.eventCount), 0);
      return count ? round2(rows.reduce((s, x) => s + num(x.eventValue), 0) / count) : null;
    };
    const vitalValue = (w: "cur" | "prev", name: string) => (ga?.[w] ? avg(ga[w]![1], (x) => x.eventName === name) : null);
    const vitalFmt = (name: string, v: number | null) => (v === null ? null : name === "CLS" ? round2(v / 1000) : Math.round(v));
    const rating = (name: string, v: number | null) => {
      const def = VITALS.find((x) => x[0] === name)!;
      if (v === null) return "—";
      return v <= def[2] ? "Good" : v <= def[3] ? "Needs work" : "Poor";
    };
    const pageSpeed = new Map<string, { lcp: number; lcpN: number; inp: number; inpN: number }>();
    for (const r of ga?.cur[3]?.rows ?? []) {
      const e = pageSpeed.get(String(r.pagePath)) ?? { lcp: 0, lcpN: 0, inp: 0, inpN: 0 };
      if (r.eventName === "LCP") {
        e.lcp += num(r.eventValue);
        e.lcpN += num(r.eventCount);
      } else {
        e.inp += num(r.eventValue);
        e.inpN += num(r.eventCount);
      }
      pageSpeed.set(String(r.pagePath), e);
    }
    const t = (w: "cur" | "prev", m: string) => (ga?.[w] ? total(ga[w]![6], m) : null);
    const errors = (w: "cur" | "prev") => (ga?.[w] ? rowSum(ga[w]![1], "eventName", "exception", "eventCount") : null);
    return [
      ...gaNotice(ctx),
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("views", "Page views", t("cur", "screenPageViews"), t("prev", "screenPageViews"), "number", "ga4"),
          kpi("perSession", "Pages per visit", t("cur", "screenPageViewsPerSession"), t("prev", "screenPageViewsPerSession"), "decimal", "ga4"),
          kpi("duration", "Average visit length", t("cur", "averageSessionDuration"), t("prev", "averageSessionDuration"), "duration", "ga4"),
          kpi("bounce", "Bounce rate", t("cur", "bounceRate") === null ? null : round2(t("cur", "bounceRate")! * 100), t("prev", "bounceRate") === null ? null : round2(t("prev", "bounceRate")! * 100), "percent", "ga4", { goodWhenUp: false, hint: "Visits that left quickly without engaging" }),
          ...VITALS.slice(0, 3).map(([name, label]) =>
            kpi(`vital${name}`, label, vitalFmt(name, vitalValue("cur", name)), vitalFmt(name, vitalValue("prev", name)), name === "CLS" ? "decimal" : "ms", "ga4", { goodWhenUp: false, hint: `Average from real visitors — ${rating(name, vitalValue("cur", name))}` })
          ),
          kpi("errors", "Page errors", errors("cur"), errors("prev"), "number", "ga4", { goodWhenUp: false, hint: "JavaScript errors seen by visitors" }),
        ],
      },
      {
        type: "table",
        id: "pages",
        title: "Pages",
        source: "ga4",
        columns: [
          { key: "page", label: "Page" },
          { key: "views", label: "Views", format: "number", align: "right" },
          { key: "users", label: "Users", format: "number", align: "right" },
          { key: "engagement", label: "Avg time", format: "duration", align: "right" },
          { key: "keyEvents", label: "Key events", format: "number", align: "right" },
        ],
        rows: (ga?.cur[0]?.rows ?? []).map((r) => ({ page: String(r.pagePath), views: num(r.screenPageViews), users: num(r.activeUsers), engagement: num(r.activeUsers) ? Math.round(num(r.userEngagementDuration) / num(r.activeUsers)) : null, keyEvents: num(r.keyEvents) })),
        empty: ctx.ga.configured ? "No data for this period." : "Needs Google Analytics.",
      },
      {
        type: "table",
        id: "vitals",
        title: "Site speed (Core Web Vitals)",
        description: "Measured on real visitors' devices. Good: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.",
        source: "ga4",
        columns: [
          { key: "metric", label: "Measure" },
          { key: "all", label: "All devices", format: "decimal", align: "right" },
          { key: "mobile", label: "Mobile", format: "decimal", align: "right" },
          { key: "desktop", label: "Desktop", format: "decimal", align: "right" },
          { key: "rating", label: "Rating" },
        ],
        rows: VITALS.map(([name, label]) => {
          const v = vitalValue("cur", name);
          const d = (device: string) => vitalFmt(name, ga ? avg(ga.cur[2], (x) => x.eventName === name && x.deviceCategory === device) : null);
          return { metric: `${label}${name === "CLS" ? "" : " (ms)"}`, all: vitalFmt(name, v), mobile: d("mobile"), desktop: d("desktop"), rating: rating(name, v) };
        }),
      },
      {
        type: "table",
        id: "slowPages",
        title: "Slowest pages",
        source: "ga4",
        columns: [
          { key: "page", label: "Page" },
          { key: "lcp", label: "LCP (ms)", format: "number", align: "right" },
          { key: "inp", label: "INP (ms)", format: "number", align: "right" },
          { key: "samples", label: "Visits measured", format: "number", align: "right" },
        ],
        rows: [...pageSpeed]
          .filter(([, e]) => e.lcpN >= 3)
          .map(([page, e]) => ({ page, lcp: Math.round(e.lcp / e.lcpN), inp: e.inpN ? Math.round(e.inp / e.inpN) : null, samples: e.lcpN }))
          .sort((a, b) => b.lcp - a.lcp)
          .slice(0, 25),
        empty: ctx.ga.configured ? "Speed data appears after a few visits." : "Needs Google Analytics.",
      },
      {
        type: "table",
        id: "errors",
        title: "Pages with errors",
        source: "ga4",
        columns: [
          { key: "page", label: "Page" },
          { key: "errors", label: "Errors", format: "number", align: "right" },
        ],
        rows: (ga?.cur[4]?.rows ?? []).map((r) => ({ page: String(r.pagePath), errors: num(r.eventCount) })),
        empty: "No errors reported.",
      },
      {
        type: "table",
        id: "notFound",
        title: "Broken links (page not found)",
        description: "Addresses visitors reached that don't exist — fix the link or redirect it.",
        source: "ga4",
        columns: [
          { key: "page", label: "Address" },
          { key: "views", label: "Visits", format: "number", align: "right" },
        ],
        rows: (ga?.cur[5]?.rows ?? []).map((r) => ({ page: String(r.pagePath), views: num(r.screenPageViews) })),
        empty: "No broken links visited.",
      },
    ];
  },
};
