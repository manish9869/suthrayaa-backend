import { HttpError } from "../../../lib/httpError.js";
import { addDays, localDay, zonedMidnight } from "../analytics.service.js";

/**
 * Date ranges for Admin → Insights: the presets, the comparison period and the chart bucket
 * size. All days are whole local days in the store's timezone.
 */

export const PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "last_90_days",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "custom",
] as const;
export type Preset = (typeof PRESETS)[number];
export type CompareMode = "previous" | "previous_year" | "custom" | "none";
export type Granularity = "day" | "week" | "month";

export interface Period {
  preset: Preset;
  from: string;
  to: string;
  days: number;
  tz: string;
  since: string;
  until: string;
  granularity: Granularity;
  compare: CompareMode;
  compareFrom: string | null;
  compareTo: string | null;
  compareSince: string | null;
  compareUntil: string | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 3660;
const DAY = 86_400_000;

const parts = (ymd: string) => ymd.split("-").map(Number) as [number, number, number];
const ymdOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

/** Monday of the week `ymd` is in. */
export function weekStart(ymd: string): string {
  const dow = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(ymd, -dow);
}

/** The same calendar day `months` months away, clamped to the month's end (31 Mar − 1 month = 28/29 Feb). */
export function shiftMonths(ymd: string, months: number): string {
  const [y, m, d] = parts(ymd);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ymdOf(ny, nm, Math.min(d, lastDayOfMonth(ny, nm)));
}

export function presetRange(preset: Exclude<Preset, "custom">, today: string): { from: string; to: string } {
  const [y, m] = parts(today);
  const q = Math.floor((m - 1) / 3);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDays(today, -1);
      return { from: d, to: d };
    }
    case "last_7_days":
    case "last_14_days":
    case "last_30_days":
    case "last_90_days": {
      const n = Number(preset.split("_")[1]);
      return { from: addDays(today, -(n - 1)), to: today };
    }
    case "this_week":
      return { from: weekStart(today), to: today };
    case "last_week": {
      const start = addDays(weekStart(today), -7);
      return { from: start, to: addDays(start, 6) };
    }
    case "this_month":
      return { from: ymdOf(y, m, 1), to: today };
    case "last_month": {
      const from = shiftMonths(ymdOf(y, m, 1), -1);
      const [ly, lm] = parts(from);
      return { from, to: ymdOf(ly, lm, lastDayOfMonth(ly, lm)) };
    }
    case "this_quarter":
      return { from: ymdOf(y, q * 3 + 1, 1), to: today };
    case "last_quarter": {
      const from = shiftMonths(ymdOf(y, q * 3 + 1, 1), -3);
      const [ly, lm] = parts(from);
      return { from, to: ymdOf(ly, lm + 2, lastDayOfMonth(ly, lm + 2)) };
    }
    case "this_year":
      return { from: ymdOf(y, 1, 1), to: today };
    case "last_year":
      return { from: ymdOf(y - 1, 1, 1), to: ymdOf(y - 1, 12, 31) };
  }
}

/**
 * The comparison range. "previous" is the period just before — for month / quarter / year
 * presets the same days one month / quarter / year earlier (1–29 Sep vs 1–29 Aug), otherwise
 * the same number of days immediately before.
 */
export function compareRange(preset: Preset, from: string, to: string, mode: CompareMode): { from: string; to: string } | null {
  if (mode === "none" || mode === "custom") return null;
  if (mode === "previous_year") return { from: shiftMonths(from, -12), to: shiftMonths(to, -12) };
  const monthsBack = preset === "this_month" || preset === "last_month" ? 1 : preset === "this_quarter" || preset === "last_quarter" ? 3 : preset === "this_year" || preset === "last_year" ? 12 : 0;
  if (monthsBack) {
    const cFrom = shiftMonths(from, -monthsBack);
    // a whole month/quarter/year compares with the whole earlier one
    const whole = preset.startsWith("last_");
    if (whole) {
      const [cy, cm] = parts(cFrom);
      const endMonth = cm + monthsBack - 1;
      return { from: cFrom, to: ymdOf(cy + Math.floor((endMonth - 1) / 12), ((endMonth - 1) % 12) + 1, lastDayOfMonth(cy + Math.floor((endMonth - 1) / 12), ((endMonth - 1) % 12) + 1)) };
    }
    return { from: cFrom, to: shiftMonths(to, -monthsBack) };
  }
  // a range of whole calendar months (e.g. 1–31 Mar) compares with the whole months before it
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  if (fd === 1 && td === lastDayOfMonth(ty, tm)) {
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    const cFrom = shiftMonths(from, -months);
    const [ey, em] = parts(shiftMonths(ymdOf(ty, tm, 1), -months));
    return { from: cFrom, to: ymdOf(ey, em, lastDayOfMonth(ey, em)) };
  }
  const days = daysBetween(from, to);
  const cTo = addDays(from, -1);
  return { from: addDays(cTo, -(days - 1)), to: cTo };
}

export function autoGranularity(days: number): Granularity {
  return days <= 45 ? "day" : days <= 190 ? "week" : "month";
}

/** The key of the chart bucket a day falls in. */
export function bucketKey(ymd: string, g: Granularity): string {
  return g === "day" ? ymd : g === "week" ? weekStart(ymd) : ymd.slice(0, 7);
}

/** The buckets covering [from, to] in order (the first/last may be partial weeks/months). */
export function buckets(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = bucketKey(d, g);
    if (out[out.length - 1] !== k) out.push(k);
  }
  return out;
}

export function bucketLabel(key: string, g: Granularity): string {
  if (g === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  }
  const d = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
  return g === "week" ? `Wk of ${d}` : d;
}

/** Parses ?preset=…&from=…&to=…&compare=…&compareFrom=…&compareTo=…&granularity=… */
export function resolvePeriod(query: Record<string, unknown>, tz: string, now = new Date()): Period {
  const q = query as Record<string, string | undefined>;
  const today = localDay(now, tz);
  const preset = (PRESETS as readonly string[]).includes(q.preset ?? "") ? (q.preset as Preset) : q.from || q.to ? "custom" : "last_30_days";

  let from: string;
  let to: string;
  if (preset === "custom") {
    if (!q.from || !q.to || !YMD.test(q.from) || !YMD.test(q.to)) throw HttpError.badRequest("Choose a start and end date (YYYY-MM-DD)");
    if (q.from > q.to) throw HttpError.badRequest("The start date must be on or before the end date");
    from = q.from;
    to = q.to;
  } else {
    ({ from, to } = presetRange(preset, today));
  }
  const days = daysBetween(from, to);
  if (days > MAX_DAYS) throw HttpError.badRequest(`Choose a range of at most ${MAX_DAYS} days`);

  const compare: CompareMode = q.compare === "previous_year" || q.compare === "custom" || q.compare === "none" ? q.compare : "previous";
  let cmp: { from: string; to: string } | null;
  if (compare === "custom") {
    if (!q.compareFrom || !q.compareTo || !YMD.test(q.compareFrom) || !YMD.test(q.compareTo) || q.compareFrom > q.compareTo) {
      throw HttpError.badRequest("Choose a start and end date for the comparison period");
    }
    cmp = { from: q.compareFrom, to: q.compareTo };
  } else {
    cmp = compareRange(preset, from, to, compare);
  }

  const granularity: Granularity = q.granularity === "day" || q.granularity === "week" || q.granularity === "month" ? q.granularity : autoGranularity(days);
  const end = (ymd: string) => new Date(zonedMidnight(addDays(ymd, 1), tz).getTime() - 1).toISOString();
  return {
    preset,
    from,
    to,
    days,
    tz,
    since: zonedMidnight(from, tz).toISOString(),
    until: end(to),
    granularity,
    compare,
    compareFrom: cmp?.from ?? null,
    compareTo: cmp?.to ?? null,
    compareSince: cmp ? zonedMidnight(cmp.from, tz).toISOString() : null,
    compareUntil: cmp ? end(cmp.to) : null,
  };
}
