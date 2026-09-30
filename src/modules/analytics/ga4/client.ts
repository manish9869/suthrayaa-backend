import { createSign } from "node:crypto";
import { env, isGa4Configured } from "../../../config/env.js";
import { HttpError } from "../../../lib/httpError.js";

/**
 * Minimal Google Analytics Data API (GA4) client — read-only reports for Admin → Insights.
 *
 * Auth is a service-account JWT exchanged for an access token (no SDK dependency). Report
 * responses are cached briefly: the admin flips between tabs and date ranges a lot, and GA4's
 * per-property quota is small. Rows come back as plain objects keyed by dimension/metric name.
 */

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://analyticsdata.googleapis.com/v1beta";
const CACHE_MS = 5 * 60_000;
const REALTIME_CACHE_MS = 20_000;
const CACHE_MAX = 400;

export interface GaFilterExpression {
  andGroup?: { expressions: GaFilterExpression[] };
  orGroup?: { expressions: GaFilterExpression[] };
  notExpression?: GaFilterExpression;
  filter?: {
    fieldName: string;
    stringFilter?: { value: string; matchType?: "EXACT" | "BEGINS_WITH" | "CONTAINS"; caseSensitive?: boolean };
    inListFilter?: { values: string[]; caseSensitive?: boolean };
  };
}

export interface GaReportRequest {
  dimensions?: string[];
  metrics: string[];
  dateRanges?: { startDate: string; endDate: string }[];
  dimensionFilter?: GaFilterExpression;
  orderBys?: { metric?: { metricName: string }; dimension?: { dimensionName: string }; desc?: boolean }[];
  limit?: number;
}

export type GaRow = Record<string, string | number>;
export interface GaReport {
  rows: GaRow[];
  totals: Record<string, number>;
  rowCount: number;
}

/** What the API is called with — swapped out in tests. */
export interface GaTransport {
  post(path: string, body: unknown): Promise<any>;
}

let token: { value: string; expires: number } | null = null;

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: env.GA4_CLIENT_EMAIL, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  )}`;
  const key = env.GA4_PRIVATE_KEY.replace(/\\n/g, "\n");
  let signature: string;
  try {
    signature = b64url(createSign("RSA-SHA256").update(unsigned).sign(key));
  } catch {
    throw new Ga4Error("The GA4 private key couldn't be read — paste the whole key from the service account's JSON file.", "GA4_BAD_KEY");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Ga4Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`, "GA4_AUTH");
  token = { value: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return token.value;
}

export class Ga4Error extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
  }
}

const httpTransport: GaTransport = {
  async post(path, body) {
    const res = await fetch(`${API}/properties/${env.GA4_PROPERTY_ID}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message ?? `GA4 request failed (${res.status})`;
      if (res.status === 403) throw new Ga4Error(`GA4 refused access — add ${env.GA4_CLIENT_EMAIL} as a Viewer on the property. (${msg})`, "GA4_FORBIDDEN");
      if (res.status === 429) throw new Ga4Error("GA4's hourly report quota is used up — try again in a few minutes.", "GA4_QUOTA");
      throw new Ga4Error(msg, "GA4_REQUEST");
    }
    return json;
  },
};

let transport: GaTransport = httpTransport;
let configuredOverride: boolean | null = null;

/** Tests: route calls to a fake GA4 and mark it configured. */
export function setGa4Transport(t: GaTransport | null) {
  transport = t ?? httpTransport;
  configuredOverride = t ? true : null;
  cache.clear();
}

// Tests never reach the real Google Analytics, even when the developer's .env has keys
export const ga4Configured = () => configuredOverride ?? (env.NODE_ENV === "test" ? false : isGa4Configured);

const cache = new Map<string, { at: number; value: any }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await load();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

function parse(resp: any, req: Pick<GaReportRequest, "dimensions" | "metrics">): GaReport {
  const dims = (resp.dimensionHeaders ?? []).map((h: any) => h.name) as string[];
  const mets = (resp.metricHeaders ?? []).map((h: any) => h.name) as string[];
  const dimNames = dims.length ? dims : req.dimensions ?? [];
  const metNames = mets.length ? mets : req.metrics;
  const rows: GaRow[] = (resp.rows ?? []).map((r: any) => {
    const row: GaRow = {};
    dimNames.forEach((d, i) => (row[d] = r.dimensionValues?.[i]?.value ?? ""));
    metNames.forEach((m, i) => (row[m] = Number(r.metricValues?.[i]?.value ?? 0)));
    return row;
  });
  const totals: Record<string, number> = {};
  const t = resp.totals?.[0];
  metNames.forEach((m, i) => (totals[m] = t ? Number(t.metricValues?.[i]?.value ?? 0) : rows.reduce((s, r) => s + Number(r[m] ?? 0), 0)));
  return { rows, totals, rowCount: Number(resp.rowCount ?? rows.length) };
}

function assertConfigured() {
  if (!ga4Configured()) throw new Ga4Error("GA4 isn't connected yet — add the GA4_* settings to the backend .env.", "GA4_NOT_CONFIGURED");
}

/** The API's wire shape: dimensions and metrics are `{ name }` objects, not plain strings. */
function toWire<T extends { dimensions?: string[]; metrics: string[] }>(r: T) {
  return { ...r, ...(r.dimensions ? { dimensions: r.dimensions.map((name) => ({ name })) } : {}), metrics: r.metrics.map((name) => ({ name })) };
}

/** Several reports in one call (GA4 allows 5 per batch; more are split). */
export async function runReports(requests: GaReportRequest[]): Promise<GaReport[]> {
  assertConfigured();
  const out: GaReport[] = [];
  for (let i = 0; i < requests.length; i += 5) {
    const chunk = requests.slice(i, i + 5).map((r) => ({ ...toWire(r), metricAggregations: ["TOTAL"], limit: r.limit ?? 250 }));
    const resp = await cached(`batch:${JSON.stringify(chunk)}`, CACHE_MS, () => transport.post(":batchRunReports", { requests: chunk }));
    (resp.reports ?? []).forEach((r: any, j: number) => out.push(parse(r, requests[i + j])));
    // a report GA4 dropped still gets a slot, so indexes line up with the request
    for (let j = (resp.reports ?? []).length; j < chunk.length; j++) out.push({ rows: [], totals: {}, rowCount: 0 });
  }
  return out;
}

/** Activity in the last 30 minutes. */
export async function runRealtime(req: Omit<GaReportRequest, "dateRanges">): Promise<GaReport> {
  assertConfigured();
  const body = { ...toWire(req), metricAggregations: ["TOTAL"], limit: req.limit ?? 50 };
  const resp = await cached(`rt:${JSON.stringify(body)}`, REALTIME_CACHE_MS, () => transport.post(":runRealtimeReport", body));
  return parse(resp, req);
}

/** Connection check for the settings/status card. */
export async function ga4Status(): Promise<{ connected: boolean; configured: boolean; propertyId: string | null; error?: string; code?: string }> {
  if (!ga4Configured()) return { connected: false, configured: false, propertyId: null, code: "GA4_NOT_CONFIGURED" };
  try {
    await runReports([{ metrics: ["activeUsers"], dateRanges: [{ startDate: "7daysAgo", endDate: "today" }] }]);
    return { connected: true, configured: true, propertyId: env.GA4_PROPERTY_ID || null };
  } catch (e) {
    return { connected: false, configured: true, propertyId: env.GA4_PROPERTY_ID || null, error: e instanceof Error ? e.message : String(e), code: e instanceof Ga4Error ? e.code : undefined };
  }
}

export const toHttp = (e: unknown) => (e instanceof Ga4Error ? HttpError.badRequest(e.message) : e);
