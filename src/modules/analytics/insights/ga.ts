import { ga4Configured, runReports, type GaFilterExpression, type GaReport, type GaReportRequest, type GaRow } from "../ga4/client.js";
import { gaFilter, type Filters, type GaScope } from "./filters.js";
import { addDays } from "../analytics.service.js";
import { buckets, bucketLabel, type Granularity, type Period } from "./period.js";
import type { Catalog } from "./store.js";

/**
 * GA4 reports for one Insights request: every report runs for the chosen period and, when
 * comparing, the comparison period, with the filter bar applied. A GA4 failure never breaks
 * the page — the section shows the store's numbers and a notice.
 */

export interface GaPair {
  cur: GaReport[];
  prev: GaReport[] | null;
}

export class GaSession {
  readonly configured = ga4Configured();
  error: string | null = null;

  constructor(
    private period: Period,
    private filters: Filters,
    private catalog?: Catalog
  ) {}

  private withFilters(req: GaReportRequest, scope: GaScope): GaReportRequest {
    const dimensionFilter = gaFilter(this.filters, scope, { product: this.catalog?.productNames, category: this.catalog?.categoryNames }, req.dimensionFilter ? [req.dimensionFilter] : []);
    return { ...req, ...(dimensionFilter ? { dimensionFilter } : {}) };
  }

  /** Reports for the period and (if comparing) the comparison period; null when GA4 is unavailable. */
  async pair(reqs: GaReportRequest[], scope: GaScope = "event"): Promise<GaPair | null> {
    if (!this.configured || this.error) return null;
    const p = this.period;
    const cur = reqs.map((r) => ({ ...this.withFilters(r, scope), dateRanges: [{ startDate: p.from, endDate: p.to }] }));
    const prev = p.compareFrom && p.compareTo ? reqs.map((r) => ({ ...this.withFilters(r, scope), dateRanges: [{ startDate: p.compareFrom!, endDate: p.compareTo! }] })) : [];
    try {
      const out = await runReports([...cur, ...prev]);
      return { cur: out.slice(0, cur.length), prev: prev.length ? out.slice(cur.length) : null };
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return null;
    }
  }
}

export const eventIn = (names: string[]): GaFilterExpression => ({ filter: { fieldName: "eventName", inListFilter: { values: names } } });
export const dimIs = (fieldName: string, value: string): GaFilterExpression => ({ filter: { fieldName, stringFilter: { value, matchType: "EXACT" } } });

export const total = (r: GaReport | undefined, metric: string): number | null => (r ? Number(r.totals[metric] ?? 0) : null);

/** Sum of `metric` over rows where `dim` === value. */
export const rowSum = (r: GaReport | undefined, dim: string, value: string, metric: string): number | null =>
  r ? r.rows.filter((x) => x[dim] === value).reduce((s, x) => s + Number(x[metric] ?? 0), 0) : null;

export const byDim = (r: GaReport | undefined, dim: string): Map<string, GaRow> => new Map((r?.rows ?? []).map((x) => [String(x[dim]), x]));

/** The GA4 date dimension matching a chart bucket size (users are de-duplicated per bucket). */
export const gaBucketDim = (g: Granularity) => (g === "day" ? "date" : g === "week" ? "isoYearIsoWeek" : "yearMonth");

/** GA4 bucket value → our bucket key (day YYYY-MM-DD, week = its Monday, month YYYY-MM). */
export function gaBucketKey(value: string, g: Granularity): string {
  if (g === "day") return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (g === "month") return `${value.slice(0, 4)}-${value.slice(4, 6)}`;
  // ISO week: the Monday of week 1 is the Monday on or before 4 January
  const year = Number(value.slice(0, 4));
  const week = Number(value.slice(4));
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = addDays(jan4.toISOString().slice(0, 10), -((jan4.getUTCDay() + 6) % 7));
  return addDays(monday, (week - 1) * 7);
}

/** GA4 rows by bucket for [from, to] in order (missing buckets → 0). */
export function gaSeries(r: GaReport | undefined, from: string, to: string, g: Granularity, metrics: string[]) {
  const dim = gaBucketDim(g);
  const map = new Map<string, GaRow>();
  for (const row of r?.rows ?? []) map.set(gaBucketKey(String(row[dim]), g), row);
  return buckets(from, to, g).map((k) => ({
    key: k,
    label: bucketLabel(k, g),
    values: Object.fromEntries(metrics.map((m) => [m, r ? Number(map.get(k)?.[m] ?? 0) : null])) as Record<string, number | null>,
  }));
}
