import { supabaseAdmin } from "../../../../config/supabase.js";
import {
  couponBreakdown,
  customerKey,
  customizationBreakdown,
  fetchAll,
  isCollected,
  localDay,
  paymentMethodBreakdown,
  productBreakdown,
  refundBreakdown,
} from "../../analytics.service.js";
import { eventIn, gaBucketDim, gaSeries, rowSum, total } from "../ga.js";
import { bucketKey, bucketLabel, buckets } from "../period.js";
import { storeSeries } from "../store.js";
import { kpi, pct, round2, shares, type Block, type Row } from "../types.js";
import { gaNotice, matchedOrders, mergeSeries, safeDiv, seriesBlock, titleCase, type SectionDef } from "./common.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: unknown) => Number(v ?? 0);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------------------------------------------------------- Sales & revenue

export const sales: SectionDef = {
  id: "sales",
  title: "Sales & revenue",
  uses: { store: true, ga: true },
  async build(ctx) {
    const { period: p } = ctx;
    const [store, ga] = await Promise.all([ctx.store(), ctx.ga.pair([{ metrics: ["purchaseRevenue", "ecommercePurchases"] }])]);
    const s = store.cur.totals;
    const ps = store.prev?.totals ?? null;
    const orders = matchedOrders(store.cur);

    const series = (r: typeof store.cur) =>
      storeSeries(r, p.granularity, p.tz).map((x) => ({ key: x.key, label: x.label, values: { gross: x.gross, net: x.revenue, orders: x.orders, units: x.units, aov: x.orders ? round2(x.gross / Math.max(1, x.orders)) : 0 } }));
    const cur = series(store.cur);
    const prev = store.prev ? series(store.prev) : null;

    // orders by weekday × hour (store timezone)
    const heat = WEEKDAYS.map(() => Array(24).fill(0) as number[]);
    const when = new Intl.DateTimeFormat("en-US", { timeZone: p.tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
    for (const o of store.cur.orders) {
      const parts = Object.fromEntries(when.formatToParts(new Date(o.placed_at)).map((x) => [x.type, x.value]));
      const day = WEEKDAYS.indexOf(String(parts.weekday).slice(0, 3));
      const hour = Number(parts.hour) % 24;
      if (day >= 0) heat[day][hour] += 1;
    }

    const statusCounts = new Map<string, number>();
    for (const o of store.cur.orders) statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
    const shipping = new Map<string, { orders: number; revenue: number }>();
    for (const o of store.cur.orders.filter(isCollected)) {
      const k = o.shipping_method || "standard";
      const e = shipping.get(k) ?? { orders: 0, revenue: 0 };
      e.orders += 1;
      e.revenue += num(o.total);
      shipping.set(k, e);
    }
    const cats = productBreakdown(orders, store.catalog.categoryNames).categories;
    const gaRevenue = total(ga?.cur[0], "purchaseRevenue");

    return [
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("gross", "Total revenue", s.gross, ps?.gross ?? null, "money", "store"),
          kpi("net", "Net revenue", s.net, ps?.net ?? null, "money", "store"),
          kpi("orders", "Orders placed", s.orders, ps?.orders ?? null, "number", "store"),
          kpi("paidOrders", "Paid orders", s.paidOrders, ps?.paidOrders ?? null, "number", "store"),
          kpi("units", "Items sold", s.units, ps?.units ?? null, "number", "store"),
          kpi("aov", "Average order value", s.aov, ps?.aov ?? null, "money", "store"),
          kpi("discounts", "Discounts given", s.discounts, ps?.discounts ?? null, "money", "store", { goodWhenUp: false }),
          kpi("shipping", "Shipping collected", s.shipping, ps?.shipping ?? null, "money", "store"),
          kpi("tax", "GST collected", s.tax, ps?.tax ?? null, "money", "store"),
          kpi("cancelled", "Cancelled orders", s.cancelledOrders, ps?.cancelledOrders ?? null, "number", "store", { goodWhenUp: false }),
          kpi("refunds", "Refunds", s.refunds, ps?.refunds ?? null, "money", "store", { goodWhenUp: false }),
          kpi("gaRevenue", "Revenue seen by Google Analytics", gaRevenue, ga?.prev ? total(ga.prev[0], "purchaseRevenue") : null, "money", "ga4", {
            hint: "For checking tracking only — usually lower than store revenue (ad blockers, declined cookies). Store revenue is the true figure.",
          }),
        ],
      },
      seriesBlock(
        "revenue",
        "Revenue over time",
        [
          { key: "gross", label: "Revenue", format: "money", source: "store" },
          { key: "net", label: "Net revenue", format: "money", source: "store" },
          { key: "orders", label: "Orders", format: "number", source: "store" },
          { key: "units", label: "Items sold", format: "number", source: "store" },
          { key: "aov", label: "Average order value", format: "money", source: "store" },
        ],
        mergeSeries(cur, prev)
      ),
      {
        type: "heatmap",
        id: "orderTimes",
        title: "When orders come in",
        description: `Orders by day and hour (${p.tz})`,
        rowLabels: WEEKDAYS,
        colLabels: Array.from({ length: 24 }, (_, h) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`)),
        values: heat,
        format: "number",
        source: "store",
      },
      { type: "breakdown", id: "payment", title: "Revenue by payment method", format: "money", source: "store", items: shares(paymentMethodBreakdown(store.cur.orders).map((m) => ({ label: titleCase(m.method), value: m.revenue }))) },
      { type: "breakdown", id: "status", title: "Orders by status", format: "number", source: "store", items: shares([...statusCounts].map(([k, v]) => ({ label: titleCase(k === "in_production" ? "making" : k), value: v })).sort((a, b) => b.value - a.value)) },
      { type: "breakdown", id: "shippingMethod", title: "Revenue by shipping method", format: "money", source: "store", items: shares([...shipping].map(([k, v]) => ({ label: titleCase(k), value: round2(v.revenue) }))) },
      {
        type: "table",
        id: "categories",
        title: "Revenue by category",
        source: "store",
        columns: [
          { key: "name", label: "Category" },
          { key: "units", label: "Items sold", format: "number", align: "right" },
          { key: "products", label: "Products", format: "number", align: "right" },
          { key: "revenue", label: "Revenue", format: "money", align: "right" },
          { key: "share", label: "Share", format: "percent", align: "right" },
        ],
        rows: cats.map((c: any) => ({ name: c.name, units: c.unitsSold, products: c.products, revenue: c.revenue, share: pct(c.revenue, s.gross) })),
      },
      {
        type: "table",
        id: "daily",
        title: `Sales by ${p.granularity}`,
        source: "store",
        columns: [
          { key: "label", label: p.granularity === "day" ? "Date" : p.granularity === "week" ? "Week" : "Month" },
          { key: "orders", label: "Orders", format: "number", align: "right" },
          { key: "units", label: "Items", format: "number", align: "right" },
          { key: "gross", label: "Revenue", format: "money", align: "right" },
          { key: "net", label: "Net revenue", format: "money", align: "right" },
          { key: "aov", label: "Avg order", format: "money", align: "right" },
        ],
        rows: cur.map((c) => ({ label: c.label, ...c.values })).reverse(),
      },
    ];
  },
};

// ---------------------------------------------------------------- Products & categories

export const products: SectionDef = {
  id: "products",
  title: "Products & categories",
  uses: { store: true, ga: true, gaItem: true },
  async build(ctx) {
    const [store, ga] = await Promise.all([
      ctx.store(),
      ctx.ga.pair(
        [
          { metrics: ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"] },
          { dimensions: ["itemName"], metrics: ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"], limit: 500, orderBys: [{ metric: { metricName: "itemsViewed" }, desc: true }] },
          { dimensions: ["itemCategory"], metrics: ["itemsViewed", "itemsAddedToCart", "itemsPurchased"], limit: 100 },
          { dimensions: ["itemListName"], metrics: ["itemsViewedInList", "itemsClickedInList"], limit: 50 },
        ],
        "item"
      ),
    ]);
    const cur = productBreakdown(matchedOrders(store.cur), store.catalog.categoryNames);
    const prev = store.prev ? productBreakdown(matchedOrders(store.prev), store.catalog.categoryNames) : null;
    const t = (i: number, m: string, w: "cur" | "prev" = "cur") => (ga?.[w] ? total(ga[w]![i], m) : null);
    const gaItems = new Map((ga?.cur[1]?.rows ?? []).map((r) => [String(r.itemName).toLowerCase(), r]));
    const gaCats = new Map((ga?.cur[2]?.rows ?? []).map((r) => [String(r.itemCategory).toLowerCase(), r]));
    const prevRevenue = new Map((prev?.products ?? []).map((x: any) => [x.productId ?? x.name, x.revenue]));

    const productRows: Row[] = cur.products.map((x: any) => {
      const g = gaItems.get(String(x.name).toLowerCase());
      return {
        name: x.name,
        sku: x.sku,
        units: x.unitsSold,
        orders: x.orders,
        revenue: x.revenue,
        change: prevRevenue.has(x.productId ?? x.name) ? round2(((x.revenue - num(prevRevenue.get(x.productId ?? x.name))) / Math.max(1, num(prevRevenue.get(x.productId ?? x.name)))) * 100) : null,
        views: g ? num(g.itemsViewed) : null,
        carts: g ? num(g.itemsAddedToCart) : null,
        cartRate: g ? pct(num(g.itemsAddedToCart), num(g.itemsViewed)) : null,
        buyRate: g ? pct(num(g.itemsPurchased), num(g.itemsViewed)) : null,
      };
    });
    // products shoppers look at but haven't bought here
    const sold = new Set(cur.products.map((x: any) => String(x.name).toLowerCase()));
    for (const [name, g] of gaItems) {
      if (sold.has(name) || !num(g.itemsViewed)) continue; // banner "items" have no product views
      productRows.push({ name: String(g.itemName), sku: null, units: 0, orders: 0, revenue: 0, change: null, views: num(g.itemsViewed), carts: num(g.itemsAddedToCart), cartRate: pct(num(g.itemsAddedToCart), num(g.itemsViewed)), buyRate: pct(num(g.itemsPurchased), num(g.itemsViewed)) });
    }
    const opportunities = productRows
      .filter((r) => num(r.views) >= 20)
      .map((r) => ({ ...r, buyRate: r.buyRate ?? 0 }))
      .sort((a, b) => num(a.buyRate) - num(b.buyRate))
      .slice(0, 10);

    return [
      ...gaNotice(ctx),
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("productRevenue", "Product revenue", round2(cur.products.reduce((s: number, x: any) => s + x.revenue, 0)), prev ? round2(prev.products.reduce((s: number, x: any) => s + x.revenue, 0)) : null, "money", "store"),
          kpi("units", "Items sold", store.cur.totals.units, store.prev?.totals.units ?? null, "number", "store"),
          kpi("productsSold", "Different products sold", cur.products.length, prev?.products.length ?? null, "number", "store"),
          kpi("views", "Product views", t(0, "itemsViewed"), t(0, "itemsViewed", "prev"), "number", "ga4"),
          kpi("carts", "Added to cart", t(0, "itemsAddedToCart"), t(0, "itemsAddedToCart", "prev"), "number", "ga4"),
          kpi("viewToCart", "View → cart rate", pct(t(0, "itemsAddedToCart") ?? 0, t(0, "itemsViewed") ?? 0), ga?.prev ? pct(t(0, "itemsAddedToCart", "prev") ?? 0, t(0, "itemsViewed", "prev") ?? 0) : null, "percent", "ga4"),
          kpi("viewToBuy", "View → purchase rate", pct(t(0, "itemsPurchased") ?? 0, t(0, "itemsViewed") ?? 0), ga?.prev ? pct(t(0, "itemsPurchased", "prev") ?? 0, t(0, "itemsViewed", "prev") ?? 0) : null, "percent", "ga4"),
        ],
      },
      {
        type: "table",
        id: "products",
        title: "Products",
        description: "Sales from your orders; views and add-to-carts from Google Analytics.",
        source: "mixed",
        columns: [
          { key: "name", label: "Product" },
          { key: "units", label: "Sold", format: "number", align: "right" },
          { key: "orders", label: "Orders", format: "number", align: "right" },
          { key: "revenue", label: "Revenue", format: "money", align: "right" },
          { key: "change", label: "vs before", format: "percent", align: "right" },
          { key: "views", label: "Views", format: "number", align: "right" },
          { key: "carts", label: "Add to cart", format: "number", align: "right" },
          { key: "cartRate", label: "Cart rate", format: "percent", align: "right" },
          { key: "buyRate", label: "Buy rate", format: "percent", align: "right" },
        ],
        rows: productRows,
      },
      {
        type: "table",
        id: "categories",
        title: "Categories",
        source: "mixed",
        columns: [
          { key: "name", label: "Category" },
          { key: "units", label: "Sold", format: "number", align: "right" },
          { key: "revenue", label: "Revenue", format: "money", align: "right" },
          { key: "views", label: "Views", format: "number", align: "right" },
          { key: "carts", label: "Add to cart", format: "number", align: "right" },
          { key: "cartRate", label: "Cart rate", format: "percent", align: "right" },
        ],
        rows: cur.categories.map((c: any) => {
          const g = gaCats.get(String(c.name).toLowerCase());
          return { name: c.name, units: c.unitsSold, revenue: c.revenue, views: g ? num(g.itemsViewed) : null, carts: g ? num(g.itemsAddedToCart) : null, cartRate: g ? pct(num(g.itemsAddedToCart), num(g.itemsViewed)) : null };
        }),
      },
      {
        type: "table",
        id: "opportunities",
        title: "Looked at a lot, rarely bought",
        description: "Products with 20+ views and the lowest purchase rate — check price, photos and description.",
        source: "ga4",
        columns: [
          { key: "name", label: "Product" },
          { key: "views", label: "Views", format: "number", align: "right" },
          { key: "cartRate", label: "Cart rate", format: "percent", align: "right" },
          { key: "buyRate", label: "Buy rate", format: "percent", align: "right" },
        ],
        rows: opportunities,
        empty: ctx.ga.configured ? "No product has 20+ views in this period yet." : "Needs Google Analytics.",
      },
      {
        type: "table",
        id: "variants",
        title: "Best-selling variants",
        source: "store",
        columns: [
          { key: "name", label: "Product" },
          { key: "variant", label: "Colour / options" },
          { key: "units", label: "Sold", format: "number", align: "right" },
          { key: "revenue", label: "Revenue", format: "money", align: "right" },
        ],
        rows: cur.variants.slice(0, 50).map((v: any) => ({ name: v.name, variant: v.variant, units: v.unitsSold, revenue: v.revenue })),
      },
      {
        type: "table",
        id: "lists",
        title: "Product lists on the site",
        description: "How often products in each list (homepage sections, shop, search…) were seen and clicked.",
        source: "ga4",
        columns: [
          { key: "list", label: "List" },
          { key: "seen", label: "Seen", format: "number", align: "right" },
          { key: "clicked", label: "Clicked", format: "number", align: "right" },
          { key: "ctr", label: "Click rate", format: "percent", align: "right" },
        ],
        rows: (ga?.cur[3]?.rows ?? [])
          .filter((r) => r.itemListName && r.itemListName !== "(not set)")
          .map((r) => ({ list: String(r.itemListName), seen: num(r.itemsViewedInList), clicked: num(r.itemsClickedInList), ctr: pct(num(r.itemsClickedInList), num(r.itemsViewedInList)) }))
          .sort((a, b) => b.seen - a.seen),
        empty: ctx.ga.configured ? "No list data yet." : "Needs Google Analytics.",
      },
    ];
  },
};

// ---------------------------------------------------------------- Customers & retention

/** Every placed order ever (lightweight) — for first-order dates and cohorts. */
async function allOrdersLite() {
  return fetchAll<any>((a, b) =>
    supabaseAdmin
      .from("orders")
      .select("id, customer_id, guest_email, shipping_address, payment_status, total, refunded_amount, placed_at")
      .not("placed_at", "is", null)
      .order("placed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b)
  ).then((rows) => rows.filter((o) => o.placed_at));
}

export const customers: SectionDef = {
  id: "customers",
  title: "Customers & retention",
  uses: { store: true, ga: true },
  async build(ctx) {
    const { period: p } = ctx;
    const bucket = gaBucketDim(p.granularity);
    const [store, ga, history, signups] = await Promise.all([
      ctx.store(),
      ctx.ga.pair([
        { dimensions: ["newVsReturning"], metrics: ["activeUsers", "sessions", "ecommercePurchases"] },
        { dimensions: [bucket, "newVsReturning"], metrics: ["activeUsers"], limit: 800 },
        { metrics: ["sessionsPerUser", "activeUsers"] },
      ]),
      allOrdersLite(),
      Promise.all([
        supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }).gte("created_at", p.since).lte("created_at", p.until),
        p.compareSince && p.compareUntil
          ? supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }).gte("created_at", p.compareSince).lte("created_at", p.compareUntil)
          : Promise.resolve({ count: null }),
      ]),
    ]);
    const s = store.cur.totals;
    const ps = store.prev?.totals ?? null;

    // first order per buyer, all time
    const first = new Map<string, string>();
    const count = new Map<string, number>();
    const lifetime = new Map<string, number>();
    for (const o of history) {
      const k = customerKey(o);
      if (!k) continue;
      if (!first.has(k)) first.set(k, o.placed_at);
      count.set(k, (count.get(k) ?? 0) + 1);
      if (isCollected(o)) lifetime.set(k, (lifetime.get(k) ?? 0) + num(o.total) - num(o.refunded_amount));
    }

    // new vs returning buyers per bucket
    const keys = buckets(p.from, p.to, p.granularity);
    const perBucket = new Map(keys.map((k) => [k, { newB: new Set<string>(), retB: new Set<string>() }]));
    for (const o of store.cur.orders) {
      const k = customerKey(o);
      const b = perBucket.get(bucketKey(localDay(o.placed_at, p.tz), p.granularity));
      if (!k || !b) continue;
      (store.cur.returning.has(k) ? b.retB : b.newB).add(k);
    }
    const gaByBucket = gaSeries(
      ga?.cur[1] ? { ...ga.cur[1], rows: aggregateNR(ga.cur[1].rows, bucket) } : undefined,
      p.from,
      p.to,
      p.granularity,
      ["newUsers", "returningUsers"]
    );
    const points = keys.map((k, i) => ({
      key: k,
      label: bucketLabel(k, p.granularity),
      values: { newCustomers: perBucket.get(k)!.newB.size, returningCustomers: perBucket.get(k)!.retB.size, newUsers: gaByBucket[i]?.values.newUsers ?? null, returningUsers: gaByBucket[i]?.values.returningUsers ?? null },
    }));

    // cohorts: customers by month of first order (last 12 months up to the period end)
    const endMonth = p.to.slice(0, 7);
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const [y, m] = endMonth.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      months.push(d.toISOString().slice(0, 7));
    }
    const cohort = new Map(months.map((m) => [m, { customers: 0, r30: 0, r60: 0, r90: 0, orders: 0, value: 0 }]));
    const ordersBy = new Map<string, number[]>();
    for (const o of history) {
      const k = customerKey(o);
      if (!k) continue;
      ordersBy.set(k, [...(ordersBy.get(k) ?? []), Date.parse(o.placed_at)]);
    }
    for (const [k, f] of first) {
      const c = cohort.get(localDay(f, p.tz).slice(0, 7));
      if (!c) continue;
      c.customers += 1;
      const t0 = Date.parse(f);
      const later = (ordersBy.get(k) ?? []).filter((t) => t > t0);
      if (later.some((t) => t - t0 <= 30 * 86_400_000)) c.r30 += 1;
      if (later.some((t) => t - t0 <= 60 * 86_400_000)) c.r60 += 1;
      if (later.some((t) => t - t0 <= 90 * 86_400_000)) c.r90 += 1;
      c.orders += count.get(k) ?? 0;
      c.value += lifetime.get(k) ?? 0;
    }

    // top customers in the period
    const buyers = new Map<string, { name: string; email: string | null; orders: number; spent: number; returning: boolean }>();
    for (const o of store.cur.orders) {
      const k = customerKey(o);
      if (!k) continue;
      const e = buyers.get(k) ?? {
        name: [o.shipping_address?.firstName, o.shipping_address?.lastName].filter(Boolean).join(" ") || "Customer",
        email: o.guest_email ?? o.shipping_address?.email ?? null,
        orders: 0,
        spent: 0,
        returning: store.cur.returning.has(k),
      };
      e.orders += 1;
      if (isCollected(o)) e.spent += num(o.total) - num(o.refunded_amount);
      buyers.set(k, e);
    }
    const byState = new Map<string, number>();
    for (const o of store.cur.orders) {
      const st = (o.shipping_address?.state as string | undefined)?.trim() || "Unknown";
      byState.set(st, (byState.get(st) ?? 0) + 1);
    }
    const guests = store.cur.orders.filter((o) => !o.customer_id).length;
    const lifetimeValues = [...lifetime.values()];
    const nr = (w: "cur" | "prev", v: string, m: string) => (ga?.[w] ? rowSum(ga[w]![0], "newVsReturning", v, m) : null);

    return [
      ...gaNotice(ctx),
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("buyers", "Customers who ordered", s.buyers, ps?.buyers ?? null, "number", "store"),
          kpi("newCustomers", "New customers", s.newCustomers, ps?.newCustomers ?? null, "number", "store"),
          kpi("returningCustomers", "Returning customers", s.returningCustomers, ps?.returningCustomers ?? null, "number", "store"),
          kpi("repeatRate", "Repeat customer rate", pct(s.returningCustomers, s.buyers), ps ? pct(ps.returningCustomers, ps.buyers) : null, "percent", "store"),
          kpi("signups", "New accounts", signups[0].count ?? 0, signups[1].count ?? null, "number", "store"),
          kpi("revenuePerCustomer", "Revenue per customer", safeDiv(s.gross, s.buyers), ps ? safeDiv(ps.gross, ps.buyers) : null, "money", "store"),
          kpi("ltv", "Average lifetime value", lifetimeValues.length ? round2(lifetimeValues.reduce((a, b) => a + b, 0) / lifetimeValues.length) : null, null, "money", "store", { hint: "All-time spend per customer" }),
          kpi("guestShare", "Guest checkout share", pct(guests, store.cur.orders.length), null, "percent", "store"),
          kpi("newUsers", "New visitors", nr("cur", "new", "activeUsers"), nr("prev", "new", "activeUsers"), "number", "ga4"),
          kpi("returningUsers", "Returning visitors", nr("cur", "returning", "activeUsers"), nr("prev", "returning", "activeUsers"), "number", "ga4"),
          kpi("sessionsPerUser", "Visits per visitor", total(ga?.cur[2], "sessionsPerUser"), ga?.prev ? total(ga.prev[2], "sessionsPerUser") : null, "decimal", "ga4"),
        ],
      },
      seriesBlock(
        "newVsReturning",
        "New vs returning",
        [
          { key: "newCustomers", label: "New customers", format: "number", source: "store" },
          { key: "returningCustomers", label: "Returning customers", format: "number", source: "store" },
          { key: "newUsers", label: "New visitors", format: "number", source: "ga4" },
          { key: "returningUsers", label: "Returning visitors", format: "number", source: "ga4" },
        ],
        points,
        { chart: "bar" }
      ),
      {
        type: "table",
        id: "cohorts",
        title: "Retention by first-order month",
        description: "Customers grouped by the month of their first order, and how many ordered again.",
        source: "store",
        columns: [
          { key: "month", label: "First order" },
          { key: "customers", label: "Customers", format: "number", align: "right" },
          { key: "r30", label: "Again within 30 days", format: "percent", align: "right" },
          { key: "r60", label: "Within 60 days", format: "percent", align: "right" },
          { key: "r90", label: "Within 90 days", format: "percent", align: "right" },
          { key: "orders", label: "Orders each", format: "decimal", align: "right" },
          { key: "value", label: "Lifetime value", format: "money", align: "right" },
        ],
        rows: [...cohort]
          .reverse()
          .map(([m, c]) => ({
            month: bucketLabel(m, "month"),
            customers: c.customers,
            r30: pct(c.r30, c.customers),
            r60: pct(c.r60, c.customers),
            r90: pct(c.r90, c.customers),
            orders: c.customers ? round2(c.orders / c.customers) : null,
            value: c.customers ? round2(c.value / c.customers) : null,
          })),
      },
      {
        type: "table",
        id: "topCustomers",
        title: "Top customers",
        source: "store",
        columns: [
          { key: "name", label: "Customer" },
          { key: "email", label: "Email" },
          { key: "type", label: "Type" },
          { key: "orders", label: "Orders", format: "number", align: "right" },
          { key: "spent", label: "Spent", format: "money", align: "right" },
        ],
        rows: [...buyers.values()]
          .sort((a, b) => b.spent - a.spent)
          .slice(0, 50)
          .map((b) => ({ name: b.name, email: b.email, type: b.returning ? "Returning" : "New", orders: b.orders, spent: round2(b.spent) })),
      },
      { type: "breakdown", id: "states", title: "Orders by state", format: "number", source: "store", items: shares([...byState].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 12)) },
      {
        type: "breakdown",
        id: "guests",
        title: "Guest vs account orders",
        format: "number",
        source: "store",
        items: shares([
          { label: "With an account", value: store.cur.orders.length - guests },
          { label: "Guest checkout", value: guests },
        ]),
      },
    ];
  },
};

/** GA rows (bucket × newVsReturning) → one row per bucket with newUsers / returningUsers. */
function aggregateNR(rows: Record<string, string | number>[], bucket: string) {
  const map = new Map<string, Record<string, string | number>>();
  for (const r of rows) {
    const k = String(r[bucket]);
    const e = map.get(k) ?? { [bucket]: k, newUsers: 0, returningUsers: 0 };
    if (r.newVsReturning === "new") e.newUsers = num(e.newUsers) + num(r.activeUsers);
    if (r.newVsReturning === "returning") e.returningUsers = num(e.returningUsers) + num(r.activeUsers);
    map.set(k, e);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- Customization

export const customization: SectionDef = {
  id: "customization",
  title: "Customization",
  uses: { store: true, ga: true },
  async build(ctx) {
    const { period: p } = ctx;
    const bucket = gaBucketDim(p.granularity);
    const events = ["customize_open", "customize_choose", "customize_reset", "customize_done"];
    const [store, ga] = await Promise.all([
      ctx.store(),
      ctx.ga.pair([
        { dimensions: ["eventName"], metrics: ["eventCount", "activeUsers"], dimensionFilter: eventIn(events) },
        { dimensions: [bucket, "eventName"], metrics: ["eventCount"], dimensionFilter: eventIn(["customize_open", "customize_done"]), limit: 800 },
        { dimensions: ["pagePath", "eventName"], metrics: ["eventCount"], dimensionFilter: eventIn(["customize_open", "customize_done", "add_to_cart"]), limit: 500 },
      ]),
    ]);
    const cur = customizationBreakdown(matchedOrders(store.cur));
    const prev = store.prev ? customizationBreakdown(matchedOrders(store.prev)) : null;
    const ev = (w: "cur" | "prev", name: string) => (ga?.[w] ? rowSum(ga[w]![0], "eventName", name, "eventCount") : null);

    // per product: which products customers customize
    const perProduct = new Map<string, { name: string; units: number; customized: number; revenue: number }>();
    for (const o of matchedOrders(store.cur).filter(isCollected)) {
      for (const i of o.order_items ?? []) {
        const k = i.product_id ?? i.product_name_snapshot;
        const e = perProduct.get(k) ?? { name: i.product_name_snapshot, units: 0, customized: 0, revenue: 0 };
        e.units += num(i.quantity);
        const custom = Boolean(i.custom_text) || (Array.isArray(i.customizations) && i.customizations.length > 0);
        if (custom) {
          e.customized += num(i.quantity);
          e.revenue += num(i.line_total);
        }
        perProduct.set(k, e);
      }
    }
    // GA: opens → added per product page
    const pages = new Map<string, { opens: number; done: number; carts: number }>();
    for (const r of ga?.cur[2]?.rows ?? []) {
      const path = String(r.pagePath);
      if (!path.startsWith("/product/")) continue;
      const e = pages.get(path) ?? { opens: 0, done: 0, carts: 0 };
      if (r.eventName === "customize_open") e.opens += num(r.eventCount);
      if (r.eventName === "customize_done") e.done += num(r.eventCount);
      if (r.eventName === "add_to_cart") e.carts += num(r.eventCount);
      pages.set(path, e);
    }
    const series = (w: "cur" | "prev", from: string, to: string) => {
      const rows = ga?.[w]?.[1]?.rows ?? [];
      const agg = new Map<string, Record<string, string | number>>();
      for (const r of rows) {
        const e = agg.get(String(r[bucket])) ?? { [bucket]: String(r[bucket]), opens: 0, done: 0 };
        if (r.eventName === "customize_open") e.opens = num(e.opens) + num(r.eventCount);
        if (r.eventName === "customize_done") e.done = num(e.done) + num(r.eventCount);
        agg.set(String(r[bucket]), e);
      }
      return gaSeries(ga?.[w] ? { rows: [...agg.values()], totals: {}, rowCount: agg.size } : undefined, from, to, p.granularity, ["opens", "done"]);
    };

    return [
      ...gaNotice(ctx),
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("share", "Items customized", cur.percentage, prev?.percentage ?? null, "percent", "store", { hint: "Share of items sold with a colour, name or other option chosen" }),
          kpi("customized", "Customized items sold", cur.customized, prev?.customized ?? null, "number", "store"),
          kpi("revenue", "Revenue from customized items", cur.customizedRevenue, prev?.customizedRevenue ?? null, "money", "store"),
          kpi("opens", "Customize window opened", ev("cur", "customize_open"), ev("prev", "customize_open"), "number", "ga4"),
          kpi("choices", "Options picked", ev("cur", "customize_choose"), ev("prev", "customize_choose"), "number", "ga4"),
          kpi("done", "Finished customizing", ev("cur", "customize_done"), ev("prev", "customize_done"), "number", "ga4"),
          kpi("completion", "Finish rate", pct(ev("cur", "customize_done") ?? 0, ev("cur", "customize_open") ?? 0), ga?.prev ? pct(ev("prev", "customize_done") ?? 0, ev("prev", "customize_open") ?? 0) : null, "percent", "ga4"),
          kpi("resets", "Reset to original", ev("cur", "customize_reset"), ev("prev", "customize_reset"), "number", "ga4", { goodWhenUp: false }),
        ],
      },
      seriesBlock(
        "activity",
        "Customize activity",
        [
          { key: "opens", label: "Opened", format: "number", source: "ga4" },
          { key: "done", label: "Finished", format: "number", source: "ga4" },
        ],
        mergeSeries(series("cur", p.from, p.to), ga?.prev && p.compareFrom && p.compareTo ? series("prev", p.compareFrom, p.compareTo) : null)
      ),
      {
        type: "table",
        id: "options",
        title: "Most chosen options",
        source: "store",
        columns: [
          { key: "label", label: "Option" },
          { key: "value", label: "Choice" },
          { key: "count", label: "Items", format: "number", align: "right" },
        ],
        rows: cur.topOptions,
      },
      {
        type: "table",
        id: "byProduct",
        title: "Customization by product",
        source: "store",
        columns: [
          { key: "name", label: "Product" },
          { key: "units", label: "Sold", format: "number", align: "right" },
          { key: "customized", label: "Customized", format: "number", align: "right" },
          { key: "share", label: "Share", format: "percent", align: "right" },
          { key: "revenue", label: "Customized revenue", format: "money", align: "right" },
        ],
        rows: [...perProduct.values()]
          .filter((e) => e.customized > 0)
          .map((e) => ({ ...e, revenue: round2(e.revenue), share: pct(e.customized, e.units) }))
          .sort((a, b) => b.customized - a.customized),
      },
      {
        type: "table",
        id: "pages",
        title: "Customize window by product page",
        source: "ga4",
        columns: [
          { key: "page", label: "Product page" },
          { key: "opens", label: "Opened", format: "number", align: "right" },
          { key: "done", label: "Finished", format: "number", align: "right" },
          { key: "carts", label: "Add to cart", format: "number", align: "right" },
          { key: "rate", label: "Open → cart", format: "percent", align: "right" },
        ],
        rows: [...pages]
          .filter(([, e]) => e.opens > 0)
          .map(([page, e]) => ({ page, ...e, rate: pct(Math.min(e.carts, e.opens), e.opens) }))
          .sort((a, b) => b.opens - a.opens),
        empty: ctx.ga.configured ? "No customize activity recorded yet." : "Needs Google Analytics.",
      },
    ];
  },
};

// ---------------------------------------------------------------- Wishlist

export const wishlist: SectionDef = {
  id: "wishlist",
  title: "Wishlist",
  uses: { store: true, ga: true },
  async build(ctx) {
    const { period: p } = ctx;
    const bucket = gaBucketDim(p.granularity);
    const [store, ga, saved] = await Promise.all([
      ctx.store(),
      ctx.ga.pair([
        { dimensions: ["eventName"], metrics: ["eventCount", "activeUsers"], dimensionFilter: eventIn(["add_to_wishlist"]) },
        { dimensions: [bucket], metrics: ["eventCount"], dimensionFilter: eventIn(["add_to_wishlist"]), limit: 400 },
      ]),
      fetchAll<any>((a, b) => supabaseAdmin.from("wishlist_items").select("id, customer_id, product_id, created_at, products(name)").order("created_at", { ascending: false }).order("id").range(a, b)),
    ]);
    const inPeriod = saved.filter((w) => w.created_at >= p.since && w.created_at <= p.until);
    const inPrev = p.compareSince && p.compareUntil ? saved.filter((w) => w.created_at >= p.compareSince! && w.created_at <= p.compareUntil!) : null;
    const soldUnits = new Map<string, number>();
    for (const o of store.cur.orders.filter(isCollected)) for (const i of o.order_items ?? []) soldUnits.set(i.product_id, (soldUnits.get(i.product_id) ?? 0) + num(i.quantity));
    const byProduct = new Map<string, { name: string; saved: number; savedInPeriod: number; people: Set<string> }>();
    for (const w of saved) {
      const e = byProduct.get(w.product_id) ?? { name: w.products?.name ?? "Deleted product", saved: 0, savedInPeriod: 0, people: new Set<string>() };
      e.saved += 1;
      if (w.created_at >= p.since && w.created_at <= p.until) e.savedInPeriod += 1;
      e.people.add(w.customer_id);
      byProduct.set(w.product_id, e);
    }
    const ev = (w: "cur" | "prev", m: string) => (ga?.[w] ? total(ga[w]![0], m) : null);
    return [
      ...gaNotice(ctx),
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("adds", "Wishlist adds", ev("cur", "eventCount"), ev("prev", "eventCount"), "number", "ga4", { hint: "Every heart tap, signed in or not (Google Analytics)" }),
          kpi("people", "People adding", ev("cur", "activeUsers"), ev("prev", "activeUsers"), "number", "ga4"),
          kpi("savedAccounts", "Saved by account holders", inPeriod.length, inPrev?.length ?? null, "number", "store", { hint: "Saved to a customer account in this period" }),
          kpi("savedTotal", "On wishlists now", saved.length, null, "number", "store"),
          kpi("customers", "Customers with a wishlist", new Set(saved.map((w) => w.customer_id)).size, null, "number", "store"),
        ],
      },
      seriesBlock(
        "adds",
        "Wishlist adds over time",
        [{ key: "eventCount", label: "Wishlist adds", format: "number", source: "ga4" }],
        mergeSeries(gaSeries(ga?.cur[1], p.from, p.to, p.granularity, ["eventCount"]), ga?.prev && p.compareFrom && p.compareTo ? gaSeries(ga.prev[1], p.compareFrom, p.compareTo, p.granularity, ["eventCount"]) : null),
        { chart: "bar" }
      ),
      {
        type: "table",
        id: "products",
        title: "Most wished-for products",
        description: "From customer accounts. \"Sold\" is in the selected period — a big gap between saves and sales is a nudge opportunity (a price drop, a back-in-stock note).",
        source: "store",
        columns: [
          { key: "name", label: "Product" },
          { key: "saved", label: "On wishlists", format: "number", align: "right" },
          { key: "savedInPeriod", label: "Saved in period", format: "number", align: "right" },
          { key: "sold", label: "Sold in period", format: "number", align: "right" },
        ],
        rows: [...byProduct]
          .map(([id, e]) => ({ name: e.name, saved: e.saved, savedInPeriod: e.savedInPeriod, sold: soldUnits.get(id) ?? 0 }))
          .sort((a, b) => b.saved - a.saved)
          .slice(0, 50),
      },
    ];
  },
};

// ---------------------------------------------------------------- Refunds & returns

const REASONS: Record<string, string> = {
  damaged: "Damaged",
  defective: "Defective",
  wrong_item: "Wrong item",
  not_as_described: "Not as described",
  changed_mind: "Changed mind",
  size_or_fit: "Size or fit",
  other: "Other",
};

export const refunds: SectionDef = {
  id: "refunds",
  title: "Refunds & returns",
  uses: { store: true, ga: false },
  async build(ctx) {
    const { period: p } = ctx;
    const [store, cur, prev, returns] = await Promise.all([
      ctx.store(),
      refundBreakdown({ since: p.since, until: p.until } as any),
      p.compareSince && p.compareUntil ? refundBreakdown({ since: p.compareSince, until: p.compareUntil } as any) : Promise.resolve(null),
      fetchAll<any>((a, b) =>
        supabaseAdmin.from("return_requests").select("id, order_id, type, status, reason, items, created_at").gte("created_at", p.since).lte("created_at", p.until).order("created_at").order("id").range(a, b)
      ),
    ]);
    // which products come back
    const itemIds = [...new Set(returns.flatMap((r) => (Array.isArray(r.items) ? r.items : []).map((i: any) => i.orderItemId)).filter(Boolean))];
    const names = new Map<string, string>();
    for (let i = 0; i < itemIds.length; i += 100) {
      const { data } = await supabaseAdmin.from("order_items").select("id, product_name_snapshot").in("id", itemIds.slice(i, i + 100));
      for (const r of data ?? []) names.set(r.id, r.product_name_snapshot);
    }
    const returnedBy = new Map<string, number>();
    for (const r of returns) for (const i of Array.isArray(r.items) ? r.items : []) {
      const n = names.get(i.orderItemId) ?? "Unknown";
      returnedBy.set(n, (returnedBy.get(n) ?? 0) + num(i.quantity || 1));
    }
    const count = (key: "reason" | "status") => {
      const m = new Map<string, number>();
      for (const r of returns) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
      return [...m].map(([k, v]) => ({ label: key === "reason" ? REASONS[k] ?? titleCase(k) : titleCase(k), value: v })).sort((a, b) => b.value - a.value);
    };
    const refundSeries = buckets(p.from, p.to, p.granularity).map((k) => ({ key: k, label: bucketLabel(k, p.granularity), values: { amount: 0, count: 0 } as Record<string, number | null> }));
    const idx = new Map(refundSeries.map((x, i) => [x.key, i]));
    const all = await fetchAll<any>((a, b) => supabaseAdmin.from("order_refunds").select("id, amount, created_at").gte("created_at", p.since).lte("created_at", p.until).order("created_at").order("id").range(a, b));
    for (const r of all) {
      const i = idx.get(bucketKey(localDay(r.created_at, p.tz), p.granularity));
      if (i === undefined) continue;
      refundSeries[i].values.amount = round2(num(refundSeries[i].values.amount) + num(r.amount));
      refundSeries[i].values.count = num(refundSeries[i].values.count) + 1;
    }
    return [
      {
        type: "notice",
        id: "basis",
        tone: "info",
        text: "Refunds here are counted on the day they were issued. Filters don't apply to this page.",
      },
      {
        type: "kpis",
        id: "kpis",
        items: [
          kpi("amount", "Refunded", cur.amount, prev?.amount ?? null, "money", "store", { goodWhenUp: false }),
          kpi("count", "Refunds issued", cur.count, prev?.count ?? null, "number", "store", { goodWhenUp: false }),
          kpi("rate", "Refund rate", pct(cur.amount, store.cur.totals.gross), prev && store.prev ? pct(prev.amount, store.prev.totals.gross) : null, "percent", "store", { goodWhenUp: false, hint: "Refunded ÷ revenue in the same period" }),
          kpi("returns", "Return / exchange requests", returns.length, null, "number", "store", { goodWhenUp: false }),
          kpi("exchanges", "Exchanges", returns.filter((r) => r.type === "exchange").length, null, "number", "store"),
        ],
      },
      seriesBlock(
        "refunds",
        "Refunds over time",
        [
          { key: "amount", label: "Refunded", format: "money", source: "store" },
          { key: "count", label: "Refunds", format: "number", source: "store" },
        ],
        refundSeries,
        { chart: "bar" }
      ),
      { type: "breakdown", id: "reasons", title: "Why items come back", format: "number", source: "store", items: shares(count("reason")) },
      { type: "breakdown", id: "status", title: "Return requests by status", format: "number", source: "store", items: shares(count("status")) },
      { type: "breakdown", id: "method", title: "Refunds by method", format: "money", source: "store", items: shares(cur.byMethod.map((m) => ({ label: titleCase(m.method), value: m.amount }))) },
      {
        type: "table",
        id: "products",
        title: "Most returned products",
        source: "store",
        columns: [
          { key: "name", label: "Product" },
          { key: "units", label: "Items returned", format: "number", align: "right" },
        ],
        rows: [...returnedBy].map(([name, units]) => ({ name, units })).sort((a, b) => b.units - a.units),
      },
      {
        type: "table",
        id: "recent",
        title: "Recent refunds",
        source: "store",
        columns: [
          { key: "orderNumber", label: "Order" },
          { key: "amount", label: "Amount", format: "money", align: "right" },
          { key: "method", label: "Method" },
          { key: "reason", label: "Reason" },
          { key: "date", label: "Date" },
        ],
        rows: cur.recent.map((r) => ({ orderNumber: r.orderNumber, amount: r.amount, method: titleCase(r.method), reason: r.reason, date: localDay(r.createdAt, p.tz) })),
      },
    ];
  },
};
