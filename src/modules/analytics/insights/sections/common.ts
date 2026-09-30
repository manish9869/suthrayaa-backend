import type { Filters } from "../filters.js";
import type { GaSession } from "../ga.js";
import type { Period } from "../period.js";
import { loadCatalog, loadStorePair, type Catalog, type StorePair, type StoreRange } from "../store.js";
import type { Block, SeriesMetric, SeriesPoint } from "../types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SectionCtx {
  period: Period;
  filters: Filters;
  ga: GaSession;
  catalog: () => Promise<Catalog>;
  store: () => Promise<StorePair>;
}

export interface SectionDef {
  id: string;
  title: string;
  /** Which data the page uses — decides which filter notes to show. */
  uses: { store: boolean; ga: boolean; gaItem?: boolean };
  build(ctx: SectionCtx): Promise<Block[]>;
  refresh?: number;
}

export function makeCtx(period: Period, filters: Filters, ga: GaSession, preloaded?: Catalog): SectionCtx {
  let catalog: Promise<Catalog> | null = preloaded ? Promise.resolve(preloaded) : null;
  let store: Promise<StorePair> | null = null;
  const getCatalog = () => (catalog ??= loadCatalog());
  return {
    period,
    filters,
    ga,
    catalog: getCatalog,
    store: () => (store ??= getCatalog().then((c) => loadStorePair(period, filters, c))),
  };
}

/** Orders whose lines are cut down to the ones the filters count (product/category filters). */
export const matchedOrders = (r: StoreRange) =>
  r.lineMatch ? r.orders.map((o) => ({ ...o, order_items: (o.order_items ?? []).filter(r.lineMatch!) })) : r.orders;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const money = (n: number) => inr.format(Math.round(n));
export const fmtPct = (n: number) => `${Math.round(n * 10) / 10}%`;
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** "vs 1–29 Aug" for insight sentences. */
export function compareLabel(p: Period): string {
  if (!p.compareFrom || !p.compareTo) return "";
  const f = (ymd: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
  return p.compareFrom === p.compareTo ? f(p.compareFrom) : `${f(p.compareFrom)} – ${f(p.compareTo)}`;
}

/**
 * Chart points: the current buckets with the comparison buckets lined up by position
 * (day 1 vs day 1 …), each carrying its own label for the tooltip.
 */
export function mergeSeries(
  cur: { key: string; label: string; values: Record<string, number | null> }[],
  prev: { key: string; label: string; values: Record<string, number | null> }[] | null
): SeriesPoint[] {
  return cur.map((p, i) => (prev && prev[i] ? { ...p, previous: prev[i].values, previousLabel: prev[i].label } : { ...p }));
}

/** Combine several same-length series (store + GA) into one set of points. */
export function zipSeries(...parts: { key: string; label: string; values: Record<string, number | null> }[][]) {
  const base = parts.find((p) => p.length) ?? [];
  return base.map((p, i) => ({ key: p.key, label: p.label, values: Object.assign({}, ...parts.map((s) => s[i]?.values ?? {})) }));
}

export function seriesBlock(id: string, title: string, metrics: SeriesMetric[], points: SeriesPoint[], extra: { description?: string; chart?: "line" | "bar" } = {}): Block {
  return { type: "series", id, title, metrics, points, ...extra };
}

export function gaNotice(ctx: SectionCtx, id = "ga-notice"): Block[] {
  if (!ctx.ga.configured) {
    return [{ type: "notice", id, tone: "info", text: "Google Analytics isn't connected yet, so visitor numbers (users, sessions, conversion, devices, traffic sources) are empty. The shop's own sales numbers are complete. See the setup steps in Insights → Settings." }];
  }
  if (ctx.ga.error) return [{ type: "notice", id, tone: "warning", text: `Google Analytics numbers couldn't be loaded: ${ctx.ga.error}` }];
  return [];
}

export const safeDiv = (a: number | null, b: number | null, scale = 1): number | null => (a === null || b === null || !b ? null : Math.round((a / b) * scale * 100) / 100);
