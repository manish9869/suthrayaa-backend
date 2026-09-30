/**
 * The shape every Insights section returns: a list of blocks the admin renders generically.
 * `source` says where a number comes from — "store" (the shop's own database, the truth for
 * money, orders, customers and refunds) or "ga4" (visits and behaviour from Google Analytics).
 */

export type Format = "money" | "number" | "percent" | "duration" | "ms" | "decimal" | "text";
export type Source = "store" | "ga4" | "mixed";

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  change: number | null;
  format: Format;
  source: Source;
  /** false when a rise is bad news (refunds, abandonment…). */
  goodWhenUp?: boolean;
  hint?: string;
}

export interface SeriesMetric {
  key: string;
  label: string;
  format: Format;
  source: Source;
}

export interface SeriesPoint {
  key: string;
  label: string;
  values: Record<string, number | null>;
  previous?: Record<string, number | null>;
  previousLabel?: string;
}

export interface Column {
  key: string;
  label: string;
  format?: Format;
  align?: "left" | "right";
}

export type Row = Record<string, string | number | null>;

export type Block =
  | { type: "kpis"; id: string; title?: string; items: Kpi[] }
  | { type: "series"; id: string; title: string; description?: string; metrics: SeriesMetric[]; points: SeriesPoint[]; chart?: "line" | "bar" }
  | { type: "table"; id: string; title: string; description?: string; columns: Column[]; rows: Row[]; source: Source; empty?: string }
  | { type: "funnel"; id: string; title: string; description?: string; steps: { label: string; value: number; previous?: number | null }[]; source: Source }
  | { type: "breakdown"; id: string; title: string; description?: string; format: Format; source: Source; items: { label: string; value: number; previous?: number | null; share: number }[] }
  | { type: "heatmap"; id: string; title: string; description?: string; rowLabels: string[]; colLabels: string[]; values: number[][]; format: Format; source: Source }
  | { type: "insights"; id: string; title?: string; items: { tone: "good" | "bad" | "neutral"; text: string }[] }
  | { type: "notice"; id: string; tone: "info" | "warning" | "error"; text: string };

export interface SectionResult {
  section: string;
  title: string;
  period: {
    from: string;
    to: string;
    compareFrom: string | null;
    compareTo: string | null;
    granularity: string;
    tz: string;
  };
  ga: { configured: boolean; connected: boolean; error?: string };
  filterNotes: string[];
  blocks: Block[];
  /** Real-time: suggested refresh interval in seconds. */
  refresh?: number;
}

export const pct = (part: number, whole: number): number | null => (whole ? Math.round((part / whole) * 10000) / 100 : null);
export const change = (cur: number | null, prev: number | null): number | null => {
  if (cur === null || prev === null) return null;
  if (!prev) return cur > 0 ? 100 : cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
};
export const round2 = (n: number) => Math.round(n * 100) / 100;

export function kpi(key: string, label: string, value: number | null, previous: number | null, format: Format, source: Source, extra: Partial<Kpi> = {}): Kpi {
  return { key, label, value, previous, change: change(value, previous), format, source, ...extra };
}

/** Bars with each item's share of the total. */
export function shares(items: { label: string; value: number; previous?: number | null }[]) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return items.map((i) => ({ ...i, share: total ? Math.round((i.value / total) * 1000) / 10 : 0 }));
}
