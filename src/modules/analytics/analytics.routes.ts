import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission, requireAnyPermission } from "../../middleware/requirePermission.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { logAudit } from "../rbac/audit.service.js";
import {
  OPEN_STATUSES,
  customerBreakdown,
  customizationBreakdown,
  couponBreakdown,
  dailySeries,
  dayList,
  fetchAll,
  gstBreakdown,
  loadCategoryNames,
  loadInventory,
  loadPlacedOrders,
  localDay,
  paymentAttempts,
  paymentMethodBreakdown,
  pctChange,
  productBreakdown,
  refundBreakdown,
  resolveRange,
  shippingBreakdown,
  summarizeOrders,
  type Range,
} from "./analytics.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Every chart/summary endpoint accepts `?days=N` (the last N days in the store's timezone,
// default 30) or `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Definitions (what counts as an order, as
// revenue) live in analytics.service.ts and are shared with the Reports endpoint.

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireAdmin);

const ORDER_STATUSES = ["pending_payment", "confirmed", "in_production", "ready", "shipped", "delivered", "cancelled", "refunded", "partially_refunded"];

analyticsRouter.get("/summary", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const range = await resolveRange(req.query);
    const [current, previous, attempts, customers, { count: totalCustomers }, { count: openOrders }, inventory] = await Promise.all([
      loadPlacedOrders(range.since, range.until, { items: true }),
      loadPlacedOrders(range.prevSince, range.prevUntil),
      paymentAttempts(range),
      Promise.all([
        supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }).gte("created_at", range.since).lte("created_at", range.until),
        supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }).gte("created_at", range.prevSince).lte("created_at", range.prevUntil),
      ]),
      supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).in("status", OPEN_STATUSES),
      loadInventory(),
    ]);
    const now = summarizeOrders(current);
    const before = summarizeOrders(previous);
    const newCustomers = customers[0].count ?? 0;
    const status = (s: string) => attempts.byStatus.find((b) => b.status === s)?.count ?? 0;

    res.json({
      revenue: now.netRevenue,
      revenueChangePct: pctChange(now.netRevenue, before.netRevenue),
      grossSales: now.grossSales,
      refunds: now.refunds,
      orderCount: now.placedOrders,
      orderCountChangePct: pctChange(now.placedOrders, before.placedOrders),
      avgOrderValue: now.avgOrderValue,
      avgOrderValueChangePct: pctChange(now.avgOrderValue, before.avgOrderValue),
      newCustomers,
      newCustomersChangePct: pctChange(newCustomers, customers[1].count ?? 0),
      totalCustomers: totalCustomers ?? 0,
      // Orders to fulfil right now (confirmed / making / ready) — a current count, not range-bound
      openOrders: openOrders ?? 0,
      pendingOrders: openOrders ?? 0,
      cancelledOrders: now.cancelledOrders,
      codToCollectValue: now.codToCollectValue,
      totalTransactions: attempts.total,
      successfulTransactions: attempts.collected,
      failedTransactions: status("failed"),
      refundedTransactions: status("refunded") + status("partially_refunded"),
      pendingTransactions: status("pending"),
      successRatePct: attempts.successRatePct,
      totalProducts: inventory.summary.totalProducts,
      activeProducts: inventory.summary.activeProducts,
      lowStockCount: inventory.summary.lowStockCount,
      outOfStockCount: inventory.summary.outOfStockCount,
      inventoryValue: inventory.summary.inventoryValue,
    });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/revenue", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const range = await resolveRange(req.query);
    const orders = await loadPlacedOrders(range.since, range.until);
    res.json(dailySeries(orders, range).map((d) => ({ date: d.date, revenue: d.revenue, orders: d.paidOrders })));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/orders-series", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const range = await resolveRange(req.query);
    const orders = await loadPlacedOrders(range.since, range.until);
    res.json(dailySeries(orders, range).map((d) => ({ date: d.date, count: d.orders })));
  } catch (err) {
    next(err);
  }
});

async function signupSeries(range: Range) {
  const rows = await fetchAll<any>((a, b) =>
    supabaseAdmin
      .from("customer_profiles")
      .select("id, created_at")
      .gte("created_at", range.since)
      .lte("created_at", range.until)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b)
  );
  const byDay = new Map<string, number>();
  for (const c of rows) {
    const key = localDay(c.created_at, range.tz);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return dayList(range.from, range.to).map((date) => ({ date, count: byDay.get(date) ?? 0 }));
}

analyticsRouter.get("/customers-series", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    res.json(await signupSeries(await resolveRange(req.query)));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/transactions-breakdown", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const attempts = await paymentAttempts(await resolveRange(req.query));
    res.json(attempts.byStatus);
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/order-status-breakdown", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const range = await resolveRange(req.query);
    const orders = await loadPlacedOrders(range.since, range.until);
    const byStatus = new Map<string, number>(ORDER_STATUSES.map((s) => [s, 0]));
    for (const o of orders) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    res.json(ORDER_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 })));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/inventory-summary", requireAnyPermission("analytics.view", "inventory.view"), async (_req, res, next) => {
  try {
    res.json((await loadInventory()).summary);
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/top-products", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const range = await resolveRange(req.query);
    const orders = await loadPlacedOrders(range.since, range.until, { items: true });
    const { products } = productBreakdown(orders, new Map());
    res.json(products.slice(0, limit).map(({ productId, name, unitsSold, revenue }) => ({ productId, name, unitsSold, revenue })));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/customization-popularity", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const range = await resolveRange(req.query);
    const c = customizationBreakdown(await loadPlacedOrders(range.since, range.until, { items: true }));
    res.json({ total: c.items, customized: c.customized, percentage: c.percentage });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/stock-alerts", requireAnyPermission("analytics.view", "inventory.view"), async (_req, res, next) => {
  try {
    res.json((await loadInventory()).alerts);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- Reports

/** Everything the Analytics & Reports page shows, for one period (plus the previous one for comparison). */
async function buildReport(range: Range) {
  const [orders, previousOrders, categories, attempts, refunds, signups, inventory] = await Promise.all([
    loadPlacedOrders(range.since, range.until, { items: true, coupons: true }),
    loadPlacedOrders(range.prevSince, range.prevUntil),
    loadCategoryNames(),
    paymentAttempts(range),
    refundBreakdown(range),
    signupSeries(range),
    loadInventory(),
  ]);
  const summary = summarizeOrders(orders);
  const previous = summarizeOrders(previousOrders);
  const sales = productBreakdown(orders, categories);
  const signupsByDay = new Map(signups.map((s) => [s.date, s.count]));

  return {
    range: { from: range.from, to: range.to, days: range.days, timezone: range.tz, previousFrom: range.prevFrom, previousTo: range.prevTo },
    summary,
    previous,
    changes: {
      netRevenue: pctChange(summary.netRevenue, previous.netRevenue),
      grossSales: pctChange(summary.grossSales, previous.grossSales),
      placedOrders: pctChange(summary.placedOrders, previous.placedOrders),
      avgOrderValue: pctChange(summary.avgOrderValue, previous.avgOrderValue),
      unitsSold: pctChange(summary.unitsSold, previous.unitsSold),
      refunds: pctChange(summary.refunds, previous.refunds),
      cancelledOrders: pctChange(summary.cancelledOrders, previous.cancelledOrders),
      discounts: pctChange(summary.discounts, previous.discounts),
    },
    series: dailySeries(orders, range).map((d) => ({ ...d, signups: signupsByDay.get(d.date) ?? 0 })),
    products: sales.products,
    variants: sales.variants,
    categories: sales.categories,
    customization: customizationBreakdown(orders),
    payments: { methods: paymentMethodBreakdown(orders), attempts },
    coupons: couponBreakdown(orders),
    refunds,
    customers: await customerBreakdown(orders, range),
    tax: gstBreakdown(orders),
    shipping: shippingBreakdown(orders),
    inventory: {
      summary: inventory.summary,
      alerts: inventory.alerts,
      products: inventory.products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku ?? null,
        status: p.status,
        stock: Number(p.stock ?? 0),
        lowStockThreshold: p.low_stock_threshold ?? 5,
        tracked: p.track_inventory !== false,
        price: Number(p.price ?? 0),
        costPrice: p.cost_price == null ? null : Number(p.cost_price),
      })),
    },
  };
}

analyticsRouter.get("/reports", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    res.json(await buildReport(await resolveRange(req.query)));
  } catch (err) {
    next(err);
  }
});

// ---- CSV export (server-side, so the analytics.export permission is actually enforced) ----

type Column = [header: string, value: (row: any) => unknown];
const EXPORTS: Record<string, { title: string; rows: (r: Awaited<ReturnType<typeof buildReport>>) => any[]; columns: Column[] }> = {
  sales: {
    title: "daily-sales",
    rows: (r) => r.series,
    columns: [["Date", (x) => x.date], ["Orders placed", (x) => x.orders], ["Paid orders", (x) => x.paidOrders], ["Gross sales", (x) => x.grossSales], ["Net revenue", (x) => x.revenue], ["New sign-ups", (x) => x.signups]],
  },
  products: {
    title: "product-sales",
    rows: (r) => r.products,
    columns: [["Product", (x) => x.name], ["SKU", (x) => x.sku], ["Units sold", (x) => x.unitsSold], ["Orders", (x) => x.orders], ["Revenue", (x) => x.revenue]],
  },
  variants: {
    title: "variant-sales",
    rows: (r) => r.variants,
    columns: [["Product", (x) => x.name], ["Variant", (x) => x.variant], ["Units sold", (x) => x.unitsSold], ["Revenue", (x) => x.revenue]],
  },
  categories: {
    title: "category-sales",
    rows: (r) => r.categories,
    columns: [["Category", (x) => x.name], ["Products sold", (x) => x.products], ["Units sold", (x) => x.unitsSold], ["Revenue", (x) => x.revenue]],
  },
  payments: {
    title: "payment-methods",
    rows: (r) => r.payments.methods,
    columns: [["Method", (x) => x.method], ["Orders", (x) => x.orders], ["Paid orders", (x) => x.paidOrders], ["Net revenue", (x) => x.revenue]],
  },
  coupons: {
    title: "coupon-performance",
    rows: (r) => r.coupons,
    columns: [["Code", (x) => x.code], ["Orders", (x) => x.orders], ["Discount given", (x) => x.discount], ["Average discount", (x) => x.avgDiscount], ["Order sales", (x) => x.sales]],
  },
  refunds: {
    title: "refunds",
    rows: (r) => r.refunds.recent,
    columns: [["Date", (x) => x.createdAt], ["Order", (x) => x.orderNumber], ["Amount", (x) => x.amount], ["Method", (x) => x.method], ["Status", (x) => x.status], ["Reason", (x) => x.reason]],
  },
  customers: {
    title: "top-customers",
    rows: (r) => r.customers.topCustomers,
    columns: [["Customer", (x) => x.name], ["Email", (x) => x.email], ["Registered", (x) => (x.customerId ? "yes" : "guest")], ["Returning", (x) => (x.returning ? "yes" : "no")], ["Orders", (x) => x.orders], ["Net spent", (x) => x.spent]],
  },
  gst: {
    title: "gst-by-state",
    rows: (r) => r.tax,
    columns: [["Place of supply", (x) => x.state], ["Orders", (x) => x.orders], ["Taxable value", (x) => x.taxableValue], ["CGST", (x) => x.cgst], ["SGST", (x) => x.sgst], ["IGST", (x) => x.igst], ["Total tax", (x) => x.totalTax], ["Invoice value", (x) => x.invoiceValue]],
  },
  shipping: {
    title: "shipping-by-state",
    rows: (r) => r.shipping.byState,
    columns: [["State", (x) => x.state], ["Orders", (x) => x.orders], ["Shipping collected", (x) => x.shippingCollected], ["Order value", (x) => x.sales]],
  },
  inventory: {
    title: "inventory",
    rows: (r) => r.inventory.products,
    columns: [["Product", (x) => x.name], ["SKU", (x) => x.sku], ["Status", (x) => x.status], ["Stock", (x) => (x.tracked ? x.stock : "not tracked")], ["Low-stock threshold", (x) => x.lowStockThreshold], ["Price", (x) => x.price], ["Cost price", (x) => x.costPrice], ["Stock value", (x) => (x.tracked ? Math.max(0, x.stock) * x.price : "")]],
  },
};

/** RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would run as a formula. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

analyticsRouter.get("/reports/export", requirePermission("analytics.export"), async (req, res, next) => {
  try {
    const section = String(req.query.section ?? "");
    const spec = EXPORTS[section];
    if (!spec) throw HttpError.badRequest(`Unknown report section. Choose one of: ${Object.keys(EXPORTS).join(", ")}`);
    const range = await resolveRange(req.query);
    const report = await buildReport(range);
    const lines = [spec.columns.map(([h]) => csvCell(h)).join(","), ...spec.rows(report).map((row) => spec.columns.map(([, get]) => csvCell(get(row))).join(","))];

    await logAudit({
      userId: req.admin!.id,
      action: "REPORT_EXPORTED",
      resource: "analytics",
      permission: "analytics.export",
      metadata: { section, from: range.from, to: range.to, rows: lines.length - 1 },
      req,
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="suthrayaa-${spec.title}-${range.from}-to-${range.to}.csv"`);
    // BOM so Excel opens ₹ and non-Latin names correctly
    res.send("﻿" + lines.join("\r\n"));
  } catch (err) {
    next(err);
  }
});
