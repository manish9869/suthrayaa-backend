import type { GaFilterExpression } from "../ga4/client.js";
import { isCustomized } from "../analytics.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The Insights filter bar. Each filter narrows whichever data it can describe: visitor filters
 * (device, browser, traffic source…) apply to GA4 numbers; order filters (coupon, payment
 * method…) to the store's own numbers; location, customer type, product and category to
 * both. `notes` tells the admin when a filter could not apply to part of a page.
 */

export const FILTER_KEYS = [
  "product",
  "category",
  "customerType",
  "device",
  "os",
  "browser",
  "country",
  "region",
  "city",
  "source",
  "medium",
  "campaign",
  "landingPage",
  "page",
  "coupon",
  "promotion",
  "customization",
  "payment",
  "shipping",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Partial<Record<FilterKey, string[]>>;

export const FILTER_LABELS: Record<FilterKey, string> = {
  product: "Product",
  category: "Category",
  customerType: "Customer type",
  device: "Device",
  os: "Operating system",
  browser: "Browser",
  country: "Country",
  region: "State / region",
  city: "City",
  source: "Traffic source",
  medium: "Medium",
  campaign: "Campaign",
  landingPage: "Landing page",
  page: "Page",
  coupon: "Coupon",
  promotion: "Promotion",
  customization: "Customization",
  payment: "Payment method",
  shipping: "Shipping method",
};

/** GA4 dimension for each visitor filter (session/user/event scoped). */
const GA_EVENT_DIMS: Partial<Record<FilterKey, string>> = {
  device: "deviceCategory",
  os: "operatingSystem",
  browser: "browser",
  country: "country",
  region: "region",
  city: "city",
  source: "sessionSource",
  medium: "sessionMedium",
  campaign: "sessionCampaignName",
  landingPage: "landingPagePlusQueryString",
  page: "pagePath",
  customerType: "newVsReturning",
};
/** Only item-level GA4 reports (product views, add-to-carts per item) can use these. */
const GA_ITEM_DIMS: Partial<Record<FilterKey, string>> = {
  product: "itemName",
  category: "itemCategory",
  promotion: "itemPromotionName",
};
/** Filters the store's own order data understands. */
const STORE_KEYS: FilterKey[] = ["product", "category", "customerType", "country", "region", "city", "coupon", "customization", "payment", "shipping"];

export function parseFilters(query: Record<string, unknown>): Filters {
  const out: Filters = {};
  for (const key of FILTER_KEYS) {
    const raw = query[key];
    const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((v) => String(v).trim()).filter((v) => v && v.length <= 200);
    if (list.length) out[key] = [...new Set(list)].slice(0, 20);
  }
  return out;
}

export const hasFilters = (f: Filters) => Object.keys(f).length > 0;

export type GaScope = "event" | "item";

/**
 * A GA4 dimension filter for these filters. Product / category values are the store's ids,
 * so `names` maps them to the names GA4 sees (item_name / item_category).
 */
export function gaFilter(filters: Filters, scope: GaScope, names: { product?: Map<string, string>; category?: Map<string, string> } = {}, extra: GaFilterExpression[] = []): GaFilterExpression | undefined {
  const expressions: GaFilterExpression[] = [...extra];
  for (const [key, values] of Object.entries(filters) as [FilterKey, string[]][]) {
    let dim = GA_EVENT_DIMS[key];
    let vals = values;
    if (!dim && scope === "item") {
      dim = GA_ITEM_DIMS[key];
      if (key === "product") vals = values.map((v) => names.product?.get(v) ?? v);
      if (key === "category") vals = values.map((v) => names.category?.get(v) ?? v);
    }
    if (!dim) continue;
    if (key === "customerType") vals = values.filter((v) => v === "new" || v === "returning");
    if (!vals.length) continue;
    expressions.push({ filter: { fieldName: dim, inListFilter: { values: vals, caseSensitive: false } } });
  }
  if (!expressions.length) return undefined;
  return expressions.length === 1 ? expressions[0] : { andGroup: { expressions } };
}

/** "Payment method applies to store numbers only", etc. — shown under the filter bar. */
export function filterNotes(filters: Filters, uses: { store: boolean; ga: boolean; gaItem?: boolean }): string[] {
  const notes: string[] = [];
  for (const key of Object.keys(filters) as FilterKey[]) {
    const onStore = STORE_KEYS.includes(key);
    const onGa = Boolean(GA_EVENT_DIMS[key]) || (uses.gaItem === true && Boolean(GA_ITEM_DIMS[key]));
    const label = FILTER_LABELS[key];
    if (uses.store && uses.ga && onStore && !onGa) notes.push(`${label} filters the shop's own numbers (orders, revenue) — not the Google Analytics visitor numbers.`);
    else if (uses.store && uses.ga && !onStore && onGa) notes.push(`${label} filters the Google Analytics visitor numbers — not orders and revenue.`);
    else if (!onStore && !onGa) notes.push(`${label} doesn't apply to this page.`);
    else if (uses.store && !uses.ga && !onStore) notes.push(`${label} doesn't apply to this page (it has no Google Analytics data).`);
    else if (uses.ga && !uses.store && !onGa) notes.push(`${label} doesn't apply to this page (it has only Google Analytics data).`);
  }
  return notes;
}

export interface OrderFilterContext {
  /** Category ids to keep, already expanded to include subcategories. */
  categoryIds?: Set<string>;
  /** Buyer keys that had ordered before the period (for customer type). */
  returning?: Set<string>;
  keyOf?: (o: any) => string | null;
}

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * The orders these filters keep and, when a product-level filter is set, which of their
 * lines count (so a product filter shows that product's revenue, not whole baskets).
 */
export function filterOrders(orders: any[], f: Filters, ctx: OrderFilterContext = {}): { orders: any[]; lineMatch: ((item: any) => boolean) | null } {
  const lineFilters: ((i: any) => boolean)[] = [];
  if (f.product) {
    const ids = new Set(f.product);
    lineFilters.push((i) => ids.has(i.product_id));
  }
  if (f.category && ctx.categoryIds) {
    const ids = ctx.categoryIds;
    lineFilters.push((i) => ids.has(i.products?.category_id));
  }
  if (f.customization) {
    const want = new Set(f.customization);
    lineFilters.push((i) => (isCustomized(i) ? want.has("customized") : want.has("standard")));
  }
  const lineMatch = lineFilters.length ? (i: any) => lineFilters.every((fn) => fn(i)) : null;

  const inList = (list: string[] | undefined, value: unknown) => !list || list.some((v) => lower(v) === lower(value));
  const kept = orders.filter((o) => {
    const addr = o.shipping_address ?? {};
    if (!inList(f.country, addr.country ?? "India")) return false;
    if (!inList(f.region, addr.state)) return false;
    if (!inList(f.city, addr.city)) return false;
    if (!inList(f.payment, o.payment_method)) return false;
    if (!inList(f.shipping, o.shipping_method || "standard")) return false;
    if (f.coupon && !f.coupon.some((c) => lower(c) === lower(o.coupons?.code))) return false;
    if (f.customerType && ctx.returning && ctx.keyOf) {
      const key = ctx.keyOf(o);
      const type = key && ctx.returning.has(key) ? "returning" : "new";
      if (!f.customerType.includes(type)) return false;
    }
    if (lineMatch && !(o.order_items ?? []).some(lineMatch)) return false;
    return true;
  });
  return { orders: kept, lineMatch };
}
