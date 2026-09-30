import { supabaseAdmin } from "../../../config/supabase.js";
import { customerKey, isCollected, loadPlacedOrders, localDay } from "../analytics.service.js";
import { filterOrders, type Filters } from "./filters.js";
import { bucketKey, buckets, bucketLabel, type Granularity, type Period } from "./period.js";
import { round2 } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The shop's own numbers for Insights — orders, revenue, customers — loaded once per range and
 * narrowed by the filters. Transactional truth: GA4 never supplies these.
 */

const num = (v: unknown) => Number(v ?? 0);

export interface Catalog {
  productNames: Map<string, string>;
  categoryNames: Map<string, string>;
  /** category id → its id plus every subcategory id */
  categoryWithChildren: (ids: string[]) => Set<string>;
}

export async function loadCatalog(): Promise<Catalog> {
  const [{ data: products }, { data: cats }] = await Promise.all([
    supabaseAdmin.from("products").select("id, name"),
    supabaseAdmin.from("categories").select("id, name, parent_id"),
  ]);
  const productNames = new Map<string, string>((products ?? []).map((p: any) => [p.id, p.name]));
  const categoryNames = new Map<string, string>((cats ?? []).map((c: any) => [c.id, c.name]));
  const children = new Map<string, string[]>();
  for (const c of cats ?? []) if (c.parent_id) children.set(c.parent_id, [...(children.get(c.parent_id) ?? []), c.id]);
  const categoryWithChildren = (ids: string[]) => {
    const out = new Set<string>();
    const walk = (id: string) => {
      if (out.has(id)) return;
      out.add(id);
      for (const k of children.get(id) ?? []) walk(k);
    };
    ids.forEach(walk);
    return out;
  };
  return { productNames, categoryNames, categoryWithChildren };
}

/** Buyers (by account, or email for guests) who had placed an order before `since`. */
export async function returningBuyers(orders: any[], since: string): Promise<Set<string>> {
  const ids = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))] as string[];
  const emails = [...new Set(orders.filter((o) => !o.customer_id).map((o) => customerKey(o)).filter(Boolean))] as string[];
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseAdmin.from("orders").select("customer_id, placed_at").in("customer_id", ids.slice(i, i + 100)).lt("placed_at", since);
    for (const r of data ?? []) if (r.customer_id && r.placed_at) out.add(r.customer_id);
  }
  for (let i = 0; i < emails.length; i += 100) {
    const { data } = await supabaseAdmin.from("orders").select("guest_email, placed_at").in("guest_email", emails.slice(i, i + 100)).lt("placed_at", since);
    for (const r of data ?? []) if (r.guest_email && r.placed_at) out.add(String(r.guest_email).toLowerCase());
  }
  return out;
}

export interface StoreRange {
  from: string;
  to: string;
  /** Every order placed in the range (unfiltered) */
  all: any[];
  /** Orders the filters keep */
  orders: any[];
  lineMatch: ((item: any) => boolean) | null;
  returning: Set<string>;
  totals: ReturnType<typeof storeTotals>;
}

export async function loadStoreRange(since: string, until: string, from: string, to: string, filters: Filters, catalog: Catalog): Promise<StoreRange> {
  const all = await loadPlacedOrders(since, until, { items: true, coupons: true });
  const returning = await returningBuyers(all, since);
  const { orders, lineMatch } = filterOrders(all, filters, {
    categoryIds: filters.category ? catalog.categoryWithChildren(filters.category) : undefined,
    returning,
    keyOf: customerKey,
  });
  return { from, to, all, orders, lineMatch, returning, totals: storeTotals(orders, lineMatch, returning) };
}

/** Lines of an order that count under the filters. */
export const linesOf = (o: any, lineMatch: StoreRange["lineMatch"]) => (lineMatch ? (o.order_items ?? []).filter(lineMatch) : o.order_items ?? []);

/** An order's value under the filters, and the share of the whole order that is. */
function orderValue(o: any, lineMatch: StoreRange["lineMatch"]) {
  if (!lineMatch) return { gross: num(o.total), share: 1 };
  const gross = linesOf(o, lineMatch).reduce((s: number, i: any) => s + num(i.line_total), 0);
  return { gross, share: num(o.total) ? Math.min(1, gross / num(o.total)) : 0 };
}

export function storeTotals(orders: any[], lineMatch: StoreRange["lineMatch"], returning: Set<string>) {
  let gross = 0;
  let refunds = 0;
  let units = 0;
  let discounts = 0;
  let shipping = 0;
  let tax = 0;
  let paid = 0;
  const buyers = new Set<string>();
  const newBuyers = new Set<string>();
  const returningSet = new Set<string>();
  for (const o of orders) {
    const key = customerKey(o);
    if (key) {
      buyers.add(key);
      if (returning.has(key)) returningSet.add(key);
      else newBuyers.add(key);
    }
    if (!isCollected(o)) continue;
    paid += 1;
    const { gross: g, share } = orderValue(o, lineMatch);
    gross += g;
    refunds += num(o.refunded_amount) * share;
    discounts += num(o.discount_amount) * share;
    shipping += lineMatch ? 0 : num(o.shipping_cost);
    tax += num(o.tax_amount) * share;
    units += linesOf(o, lineMatch).reduce((s: number, i: any) => s + num(i.quantity), 0);
  }
  const cancelled = orders.filter((o) => o.status === "cancelled");
  return {
    orders: orders.length,
    paidOrders: paid,
    gross: round2(gross),
    refunds: round2(refunds),
    net: round2(gross - refunds),
    units,
    discounts: round2(discounts),
    shipping: round2(shipping),
    tax: round2(tax),
    aov: paid ? round2(gross / paid) : 0,
    cancelledOrders: cancelled.length,
    buyers: buyers.size,
    newCustomers: newBuyers.size,
    returningCustomers: returningSet.size,
  };
}

/** Store revenue / orders / units per chart bucket. */
export function storeSeries(range: StoreRange, g: Granularity, tz: string) {
  const keys = buckets(range.from, range.to, g);
  const map = new Map(keys.map((k) => [k, { revenue: 0, gross: 0, orders: 0, units: 0 }]));
  for (const o of range.orders) {
    const e = map.get(bucketKey(localDay(o.placed_at, tz), g));
    if (!e) continue;
    e.orders += 1;
    if (!isCollected(o)) continue;
    const { gross, share } = orderValue(o, range.lineMatch);
    e.gross += gross;
    e.revenue += gross - num(o.refunded_amount) * share;
    e.units += linesOf(o, range.lineMatch).reduce((s: number, i: any) => s + num(i.quantity), 0);
  }
  return keys.map((k) => ({ key: k, label: bucketLabel(k, g), ...map.get(k)!, revenue: round2(map.get(k)!.revenue), gross: round2(map.get(k)!.gross) }));
}

export interface StorePair {
  period: Period;
  catalog: Catalog;
  cur: StoreRange;
  prev: StoreRange | null;
}

export async function loadStorePair(period: Period, filters: Filters, catalog?: Catalog): Promise<StorePair> {
  const cat = catalog ?? (await loadCatalog());
  const [cur, prev] = await Promise.all([
    loadStoreRange(period.since, period.until, period.from, period.to, filters, cat),
    period.compareSince && period.compareUntil && period.compareFrom && period.compareTo
      ? loadStoreRange(period.compareSince, period.compareUntil, period.compareFrom, period.compareTo, filters, cat)
      : Promise.resolve(null),
  ]);
  return { period, catalog: cat, cur, prev };
}
