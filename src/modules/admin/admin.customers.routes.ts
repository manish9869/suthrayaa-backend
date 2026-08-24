import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

export const adminCustomersRouter = Router();
adminCustomersRouter.use(authenticate, requireAdmin);

adminCustomersRouter.get("/", async (req, res, next) => {
  try {
    const { page = "1", limit = "50" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));

    const { data, error, count } = await supabaseAdmin
      .from("customer_profiles")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((pageNum - 1) * limitNum, pageNum * limitNum - 1);
    if (error) throw HttpError.internal(error.message);

    // Per-customer order enrichment — fine at boutique-store order volumes.
    const items = await Promise.all(
      (data ?? []).map(async (c) => {
        const { data: orders } = await supabaseAdmin
          .from("orders")
          .select("total, payment_status")
          .eq("customer_id", c.id);
        const paid = (orders ?? []).filter((o) => o.payment_status === "paid");
        return {
          id: c.id,
          email: c.email,
          phone: c.phone,
          firstName: c.first_name,
          lastName: c.last_name,
          createdAt: c.created_at,
          orderCount: paid.length,
          totalSpent: paid.reduce((s, o) => s + Number(o.total), 0),
        };
      })
    );

    res.json({ items, total: count ?? 0, page: pageNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
});

adminCustomersRouter.get("/:id", async (req, res, next) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from("customer_profiles")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!profile) throw HttpError.notFound("Customer not found");

    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, status, payment_status, total, created_at")
      .eq("customer_id", req.params.id)
      .order("created_at", { ascending: false });
    const { data: addresses } = await supabaseAdmin.from("addresses").select("*").eq("customer_id", req.params.id);

    res.json({
      id: profile.id,
      email: profile.email,
      phone: profile.phone,
      firstName: profile.first_name,
      lastName: profile.last_name,
      marketingOptIn: profile.marketing_opt_in,
      createdAt: profile.created_at,
      orders: orders ?? [],
      addresses: addresses ?? [],
    });
  } catch (err) {
    next(err);
  }
});
