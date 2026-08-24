import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireAdmin);

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

analyticsRouter.get("/summary", async (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 30);
    const since = daysAgo(days);
    const prevSince = daysAgo(days * 2);

    const { data: current } = await supabaseAdmin
      .from("orders")
      .select("total")
      .eq("payment_status", "paid")
      .gte("placed_at", since);
    const { data: previous } = await supabaseAdmin
      .from("orders")
      .select("total")
      .eq("payment_status", "paid")
      .gte("placed_at", prevSince)
      .lt("placed_at", since);

    const currentRevenue = (current ?? []).reduce((s, o) => s + Number(o.total), 0);
    const previousRevenue = (previous ?? []).reduce((s, o) => s + Number(o.total), 0);
    const orderCount = (current ?? []).length;
    const avgOrderValue = orderCount ? currentRevenue / orderCount : 0;

    const { count: newCustomers } = await supabaseAdmin
      .from("customer_profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);

    const { count: pendingOrders } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending_payment", "confirmed", "in_production"]);

    res.json({
      revenue: currentRevenue,
      revenueChangePct: previousRevenue ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : null,
      orderCount,
      avgOrderValue,
      newCustomers: newCustomers ?? 0,
      pendingOrders: pendingOrders ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/revenue", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("v_daily_sales").select("*").order("day", { ascending: true });
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map((r: any) => ({ date: r.day, orders: r.order_count, revenue: Number(r.revenue) })));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/top-products", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 10);
    const { data, error } = await supabaseAdmin
      .from("order_items")
      .select("product_id, product_name_snapshot, quantity, line_total");
    if (error) throw HttpError.internal(error.message);

    const byProduct = new Map<string, { productId: string | null; name: string; unitsSold: number; revenue: number }>();
    for (const item of data ?? []) {
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

analyticsRouter.get("/customization-popularity", async (_req, res, next) => {
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

analyticsRouter.get("/stock-alerts", async (_req, res, next) => {
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
