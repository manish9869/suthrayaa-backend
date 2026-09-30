import { Router } from "express";
import { authenticate } from "../../../middleware/auth.js";
import { requireAdmin } from "../../../middleware/requireAdmin.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { HttpError } from "../../../lib/httpError.js";
import { supabaseAdmin } from "../../../config/supabase.js";
import { getSetting } from "../../settings/settings.service.js";
import { ga4Configured, ga4Status, runReports } from "../ga4/client.js";
import { FILTER_LABELS, filterNotes, parseFilters } from "./filters.js";
import { GaSession } from "./ga.js";
import { resolvePeriod } from "./period.js";
import { makeCtx, type SectionDef } from "./sections/common.js";
import { loadCatalog } from "./store.js";
import { overview } from "./sections/overview.js";
import { customers, customization, products, refunds, sales, wishlist } from "./sections/commerce.js";
import { funnel, geography, marketing, pages, search, technology } from "./sections/behaviour.js";
import { alerts, countAlerts, realtime } from "./sections/live.js";
import type { SectionResult } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Admin → Insights. GET /api/admin/insights/:section?preset=…&compare=…&<filters> returns the
 * section's blocks. Store numbers come from the database; visitor numbers from GA4.
 */

export const SECTIONS: SectionDef[] = [overview, sales, products, customers, funnel, marketing, search, technology, geography, pages, customization, wishlist, refunds, realtime, alerts];
const byId = new Map(SECTIONS.map((s) => [s.id, s]));

export const insightsRouter = Router();
insightsRouter.use(authenticate, requireAdmin);

insightsRouter.get("/", requirePermission("analytics.view"), (_req, res) => {
  res.json({ sections: SECTIONS.map((s) => ({ id: s.id, title: s.title, usesGa: s.uses.ga, usesStore: s.uses.store, refresh: s.refresh ?? null })) });
});

insightsRouter.get("/status", requirePermission("analytics.view"), async (_req, res, next) => {
  try {
    const status = await ga4Status();
    const measurementId = (await getSetting<string>("analytics.ga_measurement_id").catch(() => "")) || null;
    res.json({ ...status, measurementId, tracking: Boolean(measurementId) });
  } catch (e) {
    next(e);
  }
});

let optionsCache: { at: number; value: any } | null = null;

/** Values for the filter bar: the shop's own lists plus the most common GA4 values. */
insightsRouter.get("/options", requirePermission("analytics.view"), async (_req, res, next) => {
  try {
    if (optionsCache && Date.now() - optionsCache.at < 5 * 60_000) {
      res.json(optionsCache.value);
      return;
    }
    const [{ data: products }, { data: categories }, { data: coupons }, { data: methods }] = await Promise.all([
      supabaseAdmin.from("products").select("id, name").order("name"),
      supabaseAdmin.from("categories").select("id, name, parent_id").order("name"),
      supabaseAdmin.from("coupons").select("code").order("code"),
      supabaseAdmin.from("orders").select("payment_method, shipping_method").not("placed_at", "is", null).order("placed_at", { ascending: false }).limit(1000),
    ]);
    const catName = new Map((categories ?? []).map((c: any) => [c.id, c.name]));
    const ga: Record<string, string[]> = {};
    const gaDims: [string, string][] = [
      ["device", "deviceCategory"],
      ["os", "operatingSystem"],
      ["browser", "browser"],
      ["country", "country"],
      ["region", "region"],
      ["city", "city"],
      ["source", "sessionSource"],
      ["medium", "sessionMedium"],
      ["campaign", "sessionCampaignName"],
      ["landingPage", "landingPagePlusQueryString"],
      ["page", "pagePath"],
    ];
    if (ga4Configured()) {
      try {
        const reports = await runReports(
          gaDims.map(([, dim]) => ({ dimensions: [dim], metrics: ["sessions"], dateRanges: [{ startDate: "90daysAgo", endDate: "today" }], limit: 60, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }))
        );
        gaDims.forEach(([key, dim], i) => (ga[key] = reports[i].rows.map((r) => String(r[dim])).filter((v) => v && v !== "(not set)")));
        const promos = await runReports([{ dimensions: ["itemPromotionName"], metrics: ["itemsViewedInPromotion"], dateRanges: [{ startDate: "90daysAgo", endDate: "today" }], limit: 50 }]);
        ga.promotion = promos[0].rows.map((r) => String(r.itemPromotionName)).filter((v) => v && v !== "(not set)");
      } catch {
        // options from GA4 are a convenience — the bar still accepts typed values
      }
    }
    const distinct = (k: string) => [...new Set((methods ?? []).map((m: any) => m[k] || (k === "shipping_method" ? "standard" : null)).filter(Boolean))] as string[];
    const value = {
      labels: FILTER_LABELS,
      options: {
        product: (products ?? []).map((p: any) => ({ value: p.id, label: p.name })),
        category: (categories ?? []).map((c: any) => ({ value: c.id, label: c.parent_id ? `${catName.get(c.parent_id) ?? ""} › ${c.name}` : c.name })),
        customerType: [
          { value: "new", label: "New customers" },
          { value: "returning", label: "Returning customers" },
        ],
        coupon: (coupons ?? []).map((c: any) => ({ value: c.code, label: c.code })),
        payment: distinct("payment_method").map((m) => ({ value: m, label: m === "cod" ? "Cash on delivery" : m.charAt(0).toUpperCase() + m.slice(1) })),
        shipping: [...new Set(["standard", "express", ...distinct("shipping_method")])].map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) })),
        customization: [
          { value: "customized", label: "Customized items" },
          { value: "standard", label: "Standard items" },
        ],
        ...Object.fromEntries(Object.entries(ga).map(([k, vals]) => [k, vals.map((v) => ({ value: v, label: k === "device" ? v.charAt(0).toUpperCase() + v.slice(1) : v }))])),
      },
    };
    optionsCache = { at: Date.now(), value };
    res.json(value);
  } catch (e) {
    next(e);
  }
});

export async function runSection(def: SectionDef, query: Record<string, unknown>): Promise<SectionResult> {
  const tz = (await getSetting<string>("store.timezone").catch(() => null)) || "Asia/Kolkata";
  const period = resolvePeriod(query, tz);
  const filters = parseFilters(query);
  // product / category filters need names to filter GA4's item reports
  const catalog = filters.product || filters.category ? await loadCatalog() : undefined;
  const ga = new GaSession(period, filters, catalog);
  const ctx = makeCtx(period, filters, ga, catalog);
  const blocks = await def.build(ctx);
  return {
    section: def.id,
    title: def.title,
    period: { from: period.from, to: period.to, compareFrom: period.compareFrom, compareTo: period.compareTo, granularity: period.granularity, tz },
    ga: { configured: ga.configured, connected: ga.configured && !ga.error, ...(ga.error ? { error: ga.error } : {}) },
    filterNotes: filterNotes(filters, def.uses),
    blocks,
    ...(def.refresh ? { refresh: def.refresh } : {}),
  };
}

insightsRouter.get("/alerts/count", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const result = await runSection(alerts, { preset: "last_7_days", ...(req.query as any) });
    res.json({ count: countAlerts(result.blocks) });
  } catch (e) {
    next(e);
  }
});

insightsRouter.get("/:section", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const def = byId.get(String(req.params.section));
    if (!def) throw HttpError.notFound("No such Insights section");
    res.json(await runSection(def, req.query as Record<string, unknown>));
  } catch (e) {
    next(e);
  }
});
