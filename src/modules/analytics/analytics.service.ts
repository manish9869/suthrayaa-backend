import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { getSetting } from "../settings/settings.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Shared analytics definitions, so the dashboard and the reports can never disagree:
 *
 * - An order counts once it is *placed* (placed_at set: COD at checkout, online once paid) —
 *   abandoned online payment attempts are not orders.
 * - Money counts once it is *collected*: payment_status paid / partially_refunded / refunded.
 *   Cash on Delivery becomes paid when the order is delivered.
 * - Net revenue = collected order totals − refunds. Everything is attributed to the day the
 *   order was placed, in the store's timezone (store.timezone, default Asia/Kolkata).
 *
 * Every query is bounded by the requested date range and fetched in pages, so a year of
 * orders is neither truncated at PostgREST's row cap nor loaded as one unbounded select.
 */

export const COLLECTED_STATUSES = ["paid", "partially_refunded", "refunded"];
export const OPEN_STATUSES = ["confirmed", "in_production", "ready"];
const MAX_RANGE_DAYS = 3660;
const PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- dates & timezone

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  return f;
}

function zonedParts(date: Date, tz: string) {
  const parts = Object.fromEntries(formatterFor(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), min: Number(parts.minute), s: Number(parts.second) };
}

/** The calendar day (YYYY-MM-DD) an instant falls on in `tz`. */
export function localDay(value: string | Date, tz: string): string {
  const { y, m, d } = zonedParts(typeof value === "string" ? new Date(value) : value, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The UTC instant of local midnight at the start of `ymd` in `tz`. */
export function zonedMidnight(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (t: number) => {
    const p = zonedParts(new Date(t), tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - t;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first)); // second pass settles DST edges
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export interface Range {
  from: string;
  to: string;
  days: number;
  tz: string;
  since: string;
  until: string;
  prevFrom: string;
  prevTo: string;
  prevSince: string;
  prevUntil: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD` (whole local days, inclusive) or `?days=N` (the last N
 * local days including today, default 30). The previous period is the same number of days
 * immediately before, for period-over-period comparison.
 */
export async function resolveRange(query: Record<string, unknown>): Promise<Range> {
  const tz = (await getSetting<string>("store.timezone").catch(() => null)) || "Asia/Kolkata";
  const { from: qFrom, to: qTo, days: qDays } = query as Record<string, string | undefined>;

  let from: string;
  let to: string;
  if (qFrom || qTo) {
    if (!qFrom || !qTo || !YMD.test(qFrom) || !YMD.test(qTo) || Number.isNaN(Date.parse(qFrom)) || Number.isNaN(Date.parse(qTo))) {
      throw HttpError.badRequest("from and to must both be dates (YYYY-MM-DD)");
    }
    if (qFrom > qTo) throw HttpError.badRequest("from must be on or before to");
    from = qFrom;
    to = qTo;
  } else {
    const n = qDays === undefined ? 30 : Number(qDays);
    if (!Number.isInteger(n) || n < 1) throw HttpError.badRequest("days must be a positive whole number");
    to = localDay(new Date(), tz);
    from = addDays(to, -(Math.min(n, MAX_RANGE_DAYS) - 1));
  }
  const days = daysBetween(from, to);
  if (days > MAX_RANGE_DAYS) throw HttpError.badRequest(`Choose a range of at most ${MAX_RANGE_DAYS} days`);

  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const end = (ymd: string) => new Date(zonedMidnight(addDays(ymd, 1), tz).getTime() - 1).toISOString();
  return {
    from,
    to,
    days,
    tz,
    since: zonedMidnight(from, tz).toISOString(),
    until: end(to),
    prevFrom,
    prevTo,
    prevSince: zonedMidnight(prevFrom, tz).toISOString(),
    prevUntil: end(prevTo),
  };
}

export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- data loading

/** Pages through a query until it's exhausted. `build` must apply a stable order. */
export async function fetchAll<T = any>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1);
    if (error) throw HttpError.internal(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

const ORDER_COLUMNS =
  "id, order_number, customer_id, guest_email, shipping_address, status, payment_status, payment_method, subtotal, discount_amount, coupon_id, shipping_cost, shipping_method, gift_wrap_cost, total, tax_amount, cgst_amount, sgst_amount, igst_amount, refunded_amount, placed_at, created_at";
const ITEM_COLUMNS = "product_id, product_name_snapshot, product_sku_snapshot, quantity, line_total, selected_color_name, custom_text, customizations";

/** Orders placed in [since, until], optionally with their items (and each item's category) and coupon code. */
export async function loadPlacedOrders(since: string, until: string, opts: { items?: boolean; coupons?: boolean } = {}) {
  const select = [ORDER_COLUMNS, opts.items ? `order_items(${ITEM_COLUMNS}, products(category_id))` : null, opts.coupons ? "coupons(code)" : null]
    .filter(Boolean)
    .join(", ");
  return fetchAll<any>((a, b) =>
    supabaseAdmin
      .from("orders")
      .select(select)
      .not("placed_at", "is", null)
      .gte("placed_at", since)
      .lte("placed_at", until)
      .order("placed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b)
  ).then((rows) => rows.filter((o) => o.placed_at)); // `.not()` is a no-op in the test double
}

export const isCollected = (o: any) => COLLECTED_STATUSES.includes(o.payment_status);
const num = (v: unknown) => Number(v ?? 0);

// ---------------------------------------------------------------- aggregations

export function summarizeOrders(orders: any[]) {
  const collected = orders.filter(isCollected);
  const grossSales = round2(collected.reduce((s, o) => s + num(o.total), 0));
  const refunds = round2(collected.reduce((s, o) => s + num(o.refunded_amount), 0));
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const codToCollect = orders.filter((o) => o.payment_method === "cod" && o.payment_status === "pending" && o.status !== "cancelled");
  const unitsSold = collected.reduce((s, o) => s + (o.order_items ?? []).reduce((q: number, i: any) => q + num(i.quantity), 0), 0);
  return {
    placedOrders: orders.length,
    paidOrders: collected.length,
    grossSales,
    refunds,
    netRevenue: round2(grossSales - refunds),
    discounts: round2(collected.reduce((s, o) => s + num(o.discount_amount), 0)),
    shipping: round2(collected.reduce((s, o) => s + num(o.shipping_cost), 0)),
    tax: round2(collected.reduce((s, o) => s + num(o.tax_amount), 0)),
    unitsSold,
    avgOrderValue: collected.length ? round2(grossSales / collected.length) : 0,
    cancelledOrders: cancelled.length,
    cancelledValue: round2(cancelled.reduce((s, o) => s + num(o.total), 0)),
    cancellationRatePct: orders.length ? round2((cancelled.length / orders.length) * 100) : 0,
    codToCollectOrders: codToCollect.length,
    codToCollectValue: round2(codToCollect.reduce((s, o) => s + num(o.total), 0)),
  };
}

export function dailySeries(orders: any[], range: Pick<Range, "from" | "to" | "tz">) {
  const byDay = new Map<string, { orders: number; paidOrders: number; revenue: number; grossSales: number }>();
  for (const o of orders) {
    const key = localDay(o.placed_at, range.tz);
    const e = byDay.get(key) ?? { orders: 0, paidOrders: 0, revenue: 0, grossSales: 0 };
    e.orders += 1;
    if (isCollected(o)) {
      e.paidOrders += 1;
      e.grossSales += num(o.total);
      e.revenue += num(o.total) - num(o.refunded_amount);
    }
    byDay.set(key, e);
  }
  return dayList(range.from, range.to).map((date) => {
    const e = byDay.get(date);
    return { date, orders: e?.orders ?? 0, paidOrders: e?.paidOrders ?? 0, revenue: round2(e?.revenue ?? 0), grossSales: round2(e?.grossSales ?? 0) };
  });
}

function variantLabel(item: any): string {
  const opts = (Array.isArray(item.customizations) ? item.customizations : [])
    .filter((c: any) => c.valueLabel)
    .map((c: any) => c.valueLabel);
  return [item.selected_color_name, ...opts].filter(Boolean).join(" / ") || "Standard";
}

export function isCustomized(item: any) {
  return Boolean(item.custom_text) || (Array.isArray(item.customizations) && item.customizations.length > 0);
}

/** Product, variant and category sales from collected orders. */
export function productBreakdown(orders: any[], categories: Map<string, string>) {
  const products = new Map<string, any>();
  const variants = new Map<string, any>();
  const cats = new Map<string, any>();
  for (const o of orders.filter(isCollected)) {
    for (const i of o.order_items ?? []) {
      const pKey = i.product_id ?? `name:${i.product_name_snapshot}`;
      const qty = num(i.quantity);
      const revenue = num(i.line_total);

      const p = products.get(pKey) ?? { productId: i.product_id, name: i.product_name_snapshot, sku: i.product_sku_snapshot ?? null, unitsSold: 0, revenue: 0, orders: new Set<string>() };
      p.unitsSold += qty;
      p.revenue += revenue;
      p.orders.add(o.id);
      products.set(pKey, p);

      const label = variantLabel(i);
      const vKey = `${pKey}::${label}`;
      const v = variants.get(vKey) ?? { productId: i.product_id, name: i.product_name_snapshot, variant: label, unitsSold: 0, revenue: 0 };
      v.unitsSold += qty;
      v.revenue += revenue;
      variants.set(vKey, v);

      const categoryId = i.products?.category_id ?? null;
      const cKey = categoryId ?? "uncategorized";
      const c = cats.get(cKey) ?? { categoryId, name: categoryId ? categories.get(categoryId) ?? "Unknown category" : "Uncategorized", unitsSold: 0, revenue: 0, products: new Set<string>() };
      c.unitsSold += qty;
      c.revenue += revenue;
      c.products.add(pKey);
      cats.set(cKey, c);
    }
  }
  const byRevenue = (a: any, b: any) => b.revenue - a.revenue;
  return {
    products: [...products.values()].map((p) => ({ ...p, revenue: round2(p.revenue), orders: p.orders.size })).sort(byRevenue),
    variants: [...variants.values()].map((v) => ({ ...v, revenue: round2(v.revenue) })).sort(byRevenue),
    categories: [...cats.values()].map((c) => ({ ...c, revenue: round2(c.revenue), products: c.products.size })).sort(byRevenue),
  };
}

export function customizationBreakdown(orders: any[]) {
  let items = 0;
  let customized = 0;
  let customizedRevenue = 0;
  const options = new Map<string, { label: string; value: string; count: number }>();
  for (const o of orders.filter(isCollected)) {
    for (const i of o.order_items ?? []) {
      items += num(i.quantity);
      if (!isCustomized(i)) continue;
      customized += num(i.quantity);
      customizedRevenue += num(i.line_total);
      for (const c of Array.isArray(i.customizations) ? i.customizations : []) {
        const value = c.valueLabel ?? (c.textValue ? "Custom text" : null);
        if (!value) continue;
        const key = `${c.label}::${value}`;
        const e = options.get(key) ?? { label: c.label, value, count: 0 };
        e.count += num(i.quantity);
        options.set(key, e);
      }
      if (i.custom_text) {
        const e = options.get("Custom text::Custom text") ?? { label: "Custom text", value: "Custom text", count: 0 };
        e.count += num(i.quantity);
        options.set("Custom text::Custom text", e);
      }
    }
  }
  return {
    items,
    customized,
    percentage: items ? Math.round((customized / items) * 1000) / 10 : 0,
    customizedRevenue: round2(customizedRevenue),
    topOptions: [...options.values()].sort((a, b) => b.count - a.count).slice(0, 15),
  };
}

export function paymentMethodBreakdown(orders: any[]) {
  const map = new Map<string, { method: string; orders: number; paidOrders: number; revenue: number }>();
  for (const o of orders) {
    const e = map.get(o.payment_method) ?? { method: o.payment_method, orders: 0, paidOrders: 0, revenue: 0 };
    e.orders += 1;
    if (isCollected(o)) {
      e.paidOrders += 1;
      e.revenue += num(o.total) - num(o.refunded_amount);
    }
    map.set(o.payment_method, e);
  }
  return [...map.values()].map((e) => ({ ...e, revenue: round2(e.revenue) })).sort((a, b) => b.revenue - a.revenue);
}

export function couponBreakdown(orders: any[]) {
  const map = new Map<string, { couponId: string; code: string; orders: number; discount: number; sales: number }>();
  for (const o of orders.filter((x) => x.coupon_id && isCollected(x))) {
    const e = map.get(o.coupon_id) ?? { couponId: o.coupon_id, code: o.coupons?.code ?? "Deleted coupon", orders: 0, discount: 0, sales: 0 };
    e.orders += 1;
    e.discount += num(o.discount_amount);
    e.sales += num(o.total);
    map.set(o.coupon_id, e);
  }
  return [...map.values()]
    .map((e) => ({ ...e, discount: round2(e.discount), sales: round2(e.sales), avgDiscount: round2(e.discount / e.orders) }))
    .sort((a, b) => b.sales - a.sales);
}

const stateOf = (o: any) => (o.shipping_address?.state as string | undefined)?.trim() || "Unknown";

/** GST collected by place of supply (the shipping state) — taxable value excludes the GST itself. */
export function gstBreakdown(orders: any[]) {
  const map = new Map<string, any>();
  // A fully refunded order is reversed by a credit note, so it's left out of the tax summary
  for (const o of orders.filter((x) => x.payment_status === "paid" || x.payment_status === "partially_refunded")) {
    const state = stateOf(o);
    const e = map.get(state) ?? { state, orders: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, invoiceValue: 0 };
    e.orders += 1;
    e.taxableValue += num(o.total) - num(o.tax_amount);
    e.cgst += num(o.cgst_amount);
    e.sgst += num(o.sgst_amount);
    e.igst += num(o.igst_amount);
    e.totalTax += num(o.tax_amount);
    e.invoiceValue += num(o.total);
    map.set(state, e);
  }
  const rows = [...map.values()].map((e) => ({
    ...e,
    taxableValue: round2(e.taxableValue),
    cgst: round2(e.cgst),
    sgst: round2(e.sgst),
    igst: round2(e.igst),
    totalTax: round2(e.totalTax),
    invoiceValue: round2(e.invoiceValue),
  }));
  return rows.sort((a, b) => b.invoiceValue - a.invoiceValue);
}

export function shippingBreakdown(orders: any[]) {
  const byState = new Map<string, { state: string; orders: number; shippingCollected: number; sales: number }>();
  const byMethod = new Map<string, { method: string; orders: number; shippingCollected: number }>();
  let freeShippingOrders = 0;
  for (const o of orders.filter((x) => x.status !== "cancelled")) {
    const state = stateOf(o);
    const s = byState.get(state) ?? { state, orders: 0, shippingCollected: 0, sales: 0 };
    s.orders += 1;
    s.shippingCollected += num(o.shipping_cost);
    s.sales += num(o.total);
    byState.set(state, s);

    const method = o.shipping_method || "standard";
    const m = byMethod.get(method) ?? { method, orders: 0, shippingCollected: 0 };
    m.orders += 1;
    m.shippingCollected += num(o.shipping_cost);
    byMethod.set(method, m);
    if (num(o.shipping_cost) === 0) freeShippingOrders += 1;
  }
  return {
    freeShippingOrders,
    byState: [...byState.values()].map((e) => ({ ...e, shippingCollected: round2(e.shippingCollected), sales: round2(e.sales) })).sort((a, b) => b.orders - a.orders),
    byMethod: [...byMethod.values()].map((e) => ({ ...e, shippingCollected: round2(e.shippingCollected) })).sort((a, b) => b.orders - a.orders),
  };
}

export const customerKey = (o: any) => o.customer_id ?? ((o.guest_email ?? o.shipping_address?.email) as string | undefined)?.toLowerCase() ?? null;

/**
 * Buyers in the period split into first-time and returning (a placed order before the period
 * started). Registered customers are matched by account, guests by email.
 */
export async function customerBreakdown(orders: any[], range: Range) {
  const buyers = new Map<string, { key: string; customerId: string | null; name: string; email: string | null; orders: number; spent: number }>();
  let guestOrders = 0;
  for (const o of orders) {
    const key = customerKey(o);
    if (!key) continue;
    if (!o.customer_id) guestOrders += 1;
    const e = buyers.get(key) ?? {
      key,
      customerId: o.customer_id ?? null,
      name: [o.shipping_address?.firstName, o.shipping_address?.lastName].filter(Boolean).join(" ") || "Customer",
      email: (o.guest_email ?? o.shipping_address?.email ?? null) as string | null,
      orders: 0,
      spent: 0,
    };
    e.orders += 1;
    if (isCollected(o)) e.spent += num(o.total) - num(o.refunded_amount);
    buyers.set(key, e);
  }

  // Who had ordered before? Looked up in chunks so the id list never outgrows a request URL.
  const returning = new Set<string>();
  const ids = [...buyers.values()].filter((b) => b.customerId).map((b) => b.customerId!) as string[];
  const emails = [...buyers.values()].filter((b) => !b.customerId && b.email).map((b) => b.email!.toLowerCase());
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseAdmin.from("orders").select("customer_id").in("customer_id", ids.slice(i, i + 100)).lt("placed_at", range.since);
    for (const r of data ?? []) if (r.customer_id) returning.add(r.customer_id);
  }
  for (let i = 0; i < emails.length; i += 100) {
    const { data } = await supabaseAdmin.from("orders").select("guest_email").in("guest_email", emails.slice(i, i + 100)).lt("placed_at", range.since);
    for (const r of data ?? []) if (r.guest_email) returning.add(String(r.guest_email).toLowerCase());
  }

  const [{ count: newSignups }, { count: prevSignups }] = await Promise.all([
    supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }).gte("created_at", range.since).lte("created_at", range.until),
    supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }).gte("created_at", range.prevSince).lte("created_at", range.prevUntil),
  ]);

  const list = [...buyers.values()];
  const returningBuyers = list.filter((b) => returning.has(b.key)).length;
  return {
    newSignups: newSignups ?? 0,
    newSignupsChangePct: pctChange(newSignups ?? 0, prevSignups ?? 0),
    buyers: list.length,
    firstTimeBuyers: list.length - returningBuyers,
    returningBuyers,
    repeatRatePct: list.length ? round2((returningBuyers / list.length) * 100) : 0,
    guestOrders,
    topCustomers: list
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 20)
      .map(({ key: _key, ...b }) => ({ ...b, spent: round2(b.spent), returning: returning.has(_key) })),
  };
}

/** Refunds issued in the period (by refund date, not order date), from the refund ledger. */
export async function refundBreakdown(range: Range) {
  const rows = await fetchAll<any>((a, b) =>
    supabaseAdmin
      .from("order_refunds")
      .select("id, order_id, amount, method, status, reason, created_at, orders(order_number)")
      .gte("created_at", range.since)
      .lte("created_at", range.until)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(a, b)
  );
  const byMethod = new Map<string, { method: string; count: number; amount: number }>();
  for (const r of rows) {
    const e = byMethod.get(r.method) ?? { method: r.method, count: 0, amount: 0 };
    e.count += 1;
    e.amount += num(r.amount);
    byMethod.set(r.method, e);
  }
  return {
    count: rows.length,
    amount: round2(rows.reduce((s, r) => s + num(r.amount), 0)),
    byMethod: [...byMethod.values()].map((e) => ({ ...e, amount: round2(e.amount) })),
    recent: rows.slice(0, 50).map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.orders?.order_number ?? null,
      amount: num(r.amount),
      method: r.method,
      status: r.status,
      reason: r.reason,
      createdAt: r.created_at,
    })),
  };
}

/** Payment attempts started in the period — includes abandoned and failed online payments. */
export async function paymentAttempts(range: Pick<Range, "since" | "until">) {
  const rows = await fetchAll<any>((a, b) =>
    supabaseAdmin
      .from("orders")
      .select("id, payment_status, payment_method, total")
      .gte("created_at", range.since)
      .lte("created_at", range.until)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b)
  );
  const byStatus = new Map<string, { count: number; amount: number }>();
  for (const status of ["pending", "paid", "failed", "refunded", "partially_refunded"]) byStatus.set(status, { count: 0, amount: 0 });
  for (const r of rows) {
    const e = byStatus.get(r.payment_status) ?? { count: 0, amount: 0 };
    e.count += 1;
    e.amount += num(r.total);
    byStatus.set(r.payment_status, e);
  }
  const collected = rows.filter(isCollected).length;
  return {
    total: rows.length,
    collected,
    successRatePct: rows.length ? (collected / rows.length) * 100 : 0,
    byStatus: [...byStatus.entries()].map(([status, e]) => ({ status, count: e.count, amount: round2(e.amount) })),
  };
}

export async function loadCategoryNames() {
  const { data } = await supabaseAdmin.from("categories").select("id, name");
  return new Map<string, string>((data ?? []).map((c: any) => [c.id, c.name]));
}

export async function loadInventory() {
  const products = await fetchAll<any>((a, b) =>
    supabaseAdmin
      .from("products")
      .select("id, name, slug, sku, stock, price, cost_price, status, low_stock_threshold, is_active, track_inventory")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b)
  );
  const tracked = (p: any) => p.is_active && p.track_inventory !== false;
  const threshold = (p: any) => p.low_stock_threshold ?? 5;
  const outOfStock = products.filter((p) => tracked(p) && num(p.stock) <= 0);
  const lowStock = products.filter((p) => tracked(p) && num(p.stock) > 0 && num(p.stock) <= threshold(p));
  return {
    products,
    summary: {
      totalProducts: products.length,
      activeProducts: products.filter((p) => p.status === "active").length,
      draftProducts: products.filter((p) => p.status === "draft").length,
      hiddenProducts: products.filter((p) => p.status === "hidden").length,
      archivedProducts: products.filter((p) => p.status === "archived").length,
      outOfStockCount: outOfStock.length,
      lowStockCount: lowStock.length,
      totalStockUnits: products.reduce((s, p) => s + Math.max(0, num(p.stock)), 0),
      inventoryValue: round2(products.reduce((s, p) => s + num(p.price) * Math.max(0, num(p.stock)), 0)),
      inventoryCostValue: round2(products.reduce((s, p) => s + num(p.cost_price) * Math.max(0, num(p.stock)), 0)),
    },
    alerts: [...outOfStock, ...lowStock]
      .sort((a, b) => num(a.stock) - num(b.stock))
      .map((p) => ({ id: p.id, name: p.name, slug: p.slug, sku: p.sku ?? null, stock: num(p.stock), low_stock_threshold: threshold(p) })),
  };
}
