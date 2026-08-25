import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission, requireAnyPermission } from "../../middleware/requirePermission.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireAdmin);

interface Range {
  since: string;
  until: string;
  prevSince: string;
  prevUntil: string;
}

// Every chart/summary endpoint accepts either `?days=N` (rolling window, default 30) or an
// explicit `?from=YYYY-MM-DD&to=YYYY-MM-DD`. `prevSince`/`prevUntil` mirror the same-length
// window immediately before it, for period-over-period change percentages.
function resolveRange(req: any): Range {
  const { from, to, days } = req.query as Record<string, string | undefined>;
  let untilDate: Date;
  let sinceDate: Date;
  if (from && to) {
    sinceDate = new Date(`${from}T00:00:00.000Z`);
    untilDate = new Date(`${to}T23:59:59.999Z`);
  } else {
    const n = Number(days) || 30;
    untilDate = new Date();
    sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - n);
  }
  const rangeMs = Math.max(untilDate.getTime() - sinceDate.getTime(), 0);
  const prevUntilDate = new Date(sinceDate.getTime() - 1);
  const prevSinceDate = new Date(prevUntilDate.getTime() - rangeMs);
  return {
    since: sinceDate.toISOString(),
    until: untilDate.toISOString(),
    prevSince: prevSinceDate.toISOString(),
    prevUntil: prevUntilDate.toISOString(),
  };
}

function pctChange(current: number, previous: number): number | null {
  if (!previous) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function fillDaySeries<T>(
  since: string,
  until: string,
  byDay: Map<string, T>,
  empty: T
): { date: string; value: T }[] {
  const out: { date: string; value: T }[] = [];
  const cursor = new Date(since.slice(0, 10) + "T00:00:00.000Z");
  const end = new Date(until.slice(0, 10) + "T00:00:00.000Z");
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ date: key, value: byDay.get(key) ?? empty });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded", "partially_refunded"] as const;
const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "in_production",
  "ready",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;

analyticsRouter.get("/summary", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const { since, until, prevSince, prevUntil } = resolveRange(req);

    const [
      { data: currentOrders },
      { data: previousOrders },
      { count: newCustomers },
      { count: previousNewCustomers },
      { count: totalCustomers },
      { count: pendingOrders },
      { count: totalProducts },
      { count: activeProducts },
      { data: stockRows },
    ] = await Promise.all([
      supabaseAdmin.from("orders").select("total, payment_status, created_at, placed_at").gte("created_at", since).lte("created_at", until),
      supabaseAdmin.from("orders").select("total, payment_status").gte("created_at", prevSince).lte("created_at", prevUntil),
      supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }).gte("created_at", since).lte("created_at", until),
      supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }).gte("created_at", prevSince).lte("created_at", prevUntil),
      supabaseAdmin.from("customer_profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending_payment", "confirmed", "in_production", "ready"]),
      supabaseAdmin.from("products").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("products").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabaseAdmin.from("products").select("stock, price, low_stock_threshold").eq("is_active", true),
    ]);

    const current = currentOrders ?? [];
    const previous = previousOrders ?? [];

    const paidCurrent = current.filter((o: any) => o.payment_status === "paid");
    const paidPrevious = previous.filter((o: any) => o.payment_status === "paid");
    const currentRevenue = paidCurrent.reduce((s: number, o: any) => s + Number(o.total), 0);
    const previousRevenue = paidPrevious.reduce((s: number, o: any) => s + Number(o.total), 0);

    const failedCurrent = current.filter((o: any) => o.payment_status === "failed");
    const refundedCurrent = current.filter((o: any) => o.payment_status === "refunded" || o.payment_status === "partially_refunded");
    const pendingTxCurrent = current.filter((o: any) => o.payment_status === "pending");

    const stock = stockRows ?? [];
    const lowStockCount = stock.filter((p: any) => p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 5)).length;
    const outOfStockCount = stock.filter((p: any) => p.stock <= 0).length;
    const inventoryValue = stock.reduce((s: number, p: any) => s + Number(p.price) * Number(p.stock), 0);

    res.json({
      revenue: currentRevenue,
      revenueChangePct: pctChange(currentRevenue, previousRevenue),
      orderCount: current.length,
      orderCountChangePct: pctChange(current.length, previous.length),
      avgOrderValue: paidCurrent.length ? currentRevenue / paidCurrent.length : 0,
      newCustomers: newCustomers ?? 0,
      newCustomersChangePct: pctChange(newCustomers ?? 0, previousNewCustomers ?? 0),
      totalCustomers: totalCustomers ?? 0,
      pendingOrders: pendingOrders ?? 0,
      totalTransactions: current.length,
      successfulTransactions: paidCurrent.length,
      failedTransactions: failedCurrent.length,
      refundedTransactions: refundedCurrent.length,
      pendingTransactions: pendingTxCurrent.length,
      successRatePct: current.length ? (paidCurrent.length / current.length) * 100 : 0,
      totalProducts: totalProducts ?? 0,
      activeProducts: activeProducts ?? 0,
      lowStockCount,
      outOfStockCount,
      inventoryValue,
    });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/revenue", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const { since, until } = resolveRange(req);
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("total, placed_at")
      .eq("payment_status", "paid")
      .gte("placed_at", since)
      .lte("placed_at", until);
    if (error) throw HttpError.internal(error.message);

    const revenueByDay = new Map<string, number>();
    const ordersByDay = new Map<string, number>();
    for (const o of data ?? []) {
      if (!o.placed_at) continue;
      const key = dayKey(o.placed_at);
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + Number(o.total));
      ordersByDay.set(key, (ordersByDay.get(key) ?? 0) + 1);
    }

    const days = fillDaySeries(since, until, revenueByDay, 0);
    res.json(days.map((d) => ({ date: d.date, revenue: d.value, orders: ordersByDay.get(d.date) ?? 0 })));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/orders-series", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const { since, until } = resolveRange(req);
    const { data, error } = await supabaseAdmin.from("orders").select("created_at").gte("created_at", since).lte("created_at", until);
    if (error) throw HttpError.internal(error.message);

    const byDay = new Map<string, number>();
    for (const o of data ?? []) {
      const key = dayKey(o.created_at);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    res.json(fillDaySeries(since, until, byDay, 0).map((d) => ({ date: d.date, count: d.value })));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/customers-series", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const { since, until } = resolveRange(req);
    const { data, error } = await supabaseAdmin
      .from("customer_profiles")
      .select("created_at")
      .gte("created_at", since)
      .lte("created_at", until);
    if (error) throw HttpError.internal(error.message);

    const byDay = new Map<string, number>();
    for (const c of data ?? []) {
      const key = dayKey(c.created_at);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    res.json(fillDaySeries(since, until, byDay, 0).map((d) => ({ date: d.date, count: d.value })));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/transactions-breakdown", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const { since, until } = resolveRange(req);
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("payment_status, total")
      .gte("created_at", since)
      .lte("created_at", until);
    if (error) throw HttpError.internal(error.message);

    const byStatus = new Map<string, { count: number; amount: number }>();
    for (const status of PAYMENT_STATUSES) byStatus.set(status, { count: 0, amount: 0 });
    for (const o of data ?? []) {
      const entry = byStatus.get(o.payment_status) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += Number(o.total);
      byStatus.set(o.payment_status, entry);
    }

    res.json(
      PAYMENT_STATUSES.map((status) => ({
        status,
        count: byStatus.get(status)?.count ?? 0,
        amount: byStatus.get(status)?.amount ?? 0,
      }))
    );
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/order-status-breakdown", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const { since, until } = resolveRange(req);
    const { data, error } = await supabaseAdmin.from("orders").select("status").gte("created_at", since).lte("created_at", until);
    if (error) throw HttpError.internal(error.message);

    const byStatus = new Map<string, number>();
    for (const status of ORDER_STATUSES) byStatus.set(status, 0);
    for (const o of data ?? []) {
      byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    }

    res.json(ORDER_STATUSES.map((status) => ({ status, count: byStatus.get(status) ?? 0 })));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/inventory-summary", requireAnyPermission("analytics.view", "inventory.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("products").select("stock, price, status, low_stock_threshold, is_active");
    if (error) throw HttpError.internal(error.message);

    const products = data ?? [];
    const active = products.filter((p: any) => p.status === "active");
    const draft = products.filter((p: any) => p.status === "draft");
    const hidden = products.filter((p: any) => p.status === "hidden");
    const archived = products.filter((p: any) => p.status === "archived");
    const outOfStock = products.filter((p: any) => p.is_active && p.stock <= 0);
    const lowStock = products.filter((p: any) => p.is_active && p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 5));
    const totalStockUnits = products.reduce((s: number, p: any) => s + Number(p.stock), 0);
    const inventoryValue = products.reduce((s: number, p: any) => s + Number(p.price) * Number(p.stock), 0);

    res.json({
      totalProducts: products.length,
      activeProducts: active.length,
      draftProducts: draft.length,
      hiddenProducts: hidden.length,
      archivedProducts: archived.length,
      outOfStockCount: outOfStock.length,
      lowStockCount: lowStock.length,
      totalStockUnits,
      inventoryValue,
    });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/top-products", requirePermission("analytics.view"), async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 10);
    const hasRange = Boolean(req.query.days || (req.query.from && req.query.to));

    let items: any[];
    if (hasRange) {
      const { since, until } = resolveRange(req);
      const { data: orders, error: ordersErr } = await supabaseAdmin
        .from("orders")
        .select("id")
        .gte("created_at", since)
        .lte("created_at", until);
      if (ordersErr) throw HttpError.internal(ordersErr.message);
      const orderIds = (orders ?? []).map((o: any) => o.id);
      if (orderIds.length === 0) {
        res.json([]);
        return;
      }
      const { data, error } = await supabaseAdmin
        .from("order_items")
        .select("product_id, product_name_snapshot, quantity, line_total")
        .in("order_id", orderIds);
      if (error) throw HttpError.internal(error.message);
      items = data ?? [];
    } else {
      const { data, error } = await supabaseAdmin
        .from("order_items")
        .select("product_id, product_name_snapshot, quantity, line_total");
      if (error) throw HttpError.internal(error.message);
      items = data ?? [];
    }

    const byProduct = new Map<string, { productId: string | null; name: string; unitsSold: number; revenue: number }>();
    for (const item of items) {
      const key = item.product_id ?? item.product_name_snapshot;
      const entry = byProduct.get(key) ?? {
        productId: item.product_id,
        name: item.product_name_snapshot,
        unitsSold: 0,
        revenue: 0,
      };
      entry.unitsSold += item.quantity;
      entry.revenue += Number(item.line_total);
      byProduct.set(key, entry);
    }

    res.json(
      Array.from(byProduct.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit)
    );
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/customization-popularity", requirePermission("analytics.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("order_items").select("custom_text");
    if (error) throw HttpError.internal(error.message);
    const total = (data ?? []).length;
    const customized = (data ?? []).filter((i) => i.custom_text).length;
    res.json({ total, customized, percentage: total ? Math.round((customized / total) * 1000) / 10 : 0 });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/stock-alerts", requireAnyPermission("analytics.view", "inventory.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, name, slug, stock, low_stock_threshold")
      .eq("is_active", true);
    if (error) throw HttpError.internal(error.message);

    const alerts = (data ?? [])
      .filter((p) => p.stock <= (p.low_stock_threshold ?? 5))
      .sort((a, b) => a.stock - b.stock);
    res.json(alerts);
  } catch (err) {
    next(err);
  }
});
