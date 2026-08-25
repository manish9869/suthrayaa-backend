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
    const limitNum = Math.min(300, Math.max(1, Number(limit) || 50));

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
      .select("id, order_number, status, payment_status, payment_method, total, tracking_number, placed_at, created_at, order_items(quantity)")
      .eq("customer_id", req.params.id)
      .order("created_at", { ascending: false });
    const { data: addresses } = await supabaseAdmin.from("addresses").select("*").eq("customer_id", req.params.id);

    const allOrders = orders ?? [];
    const paidOrders = allOrders.filter((o: any) => o.payment_status === "paid");
    const totalSpent = paidOrders.reduce((s: number, o: any) => s + Number(o.total), 0);
    const failedOrders = allOrders.filter((o: any) => o.payment_status === "failed").length;
    const refundedOrders = allOrders.filter((o: any) => o.payment_status === "refunded" || o.payment_status === "partially_refunded").length;

    res.json({
      id: profile.id,
      email: profile.email,
      phone: profile.phone,
      firstName: profile.first_name,
      lastName: profile.last_name,
      marketingOptIn: profile.marketing_opt_in,
      createdAt: profile.created_at,
      stats: {
        orderCount: allOrders.length,
        paidOrderCount: paidOrders.length,
        failedOrderCount: failedOrders,
        refundedOrderCount: refundedOrders,
        totalSpent,
        avgOrderValue: paidOrders.length ? totalSpent / paidOrders.length : 0,
        lastOrderAt: allOrders[0]?.created_at ?? null,
      },
      orders: allOrders.map((o: any) => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        paymentStatus: o.payment_status,
        paymentMethod: o.payment_method,
        total: Number(o.total),
        itemCount: (o.order_items ?? []).reduce((s: number, i: any) => s + i.quantity, 0),
        trackingNumber: o.tracking_number,
        placedAt: o.placed_at,
        createdAt: o.created_at,
      })),
      addresses: addresses ?? [],
    });
  } catch (err) {
    next(err);
  }
});

adminCustomersRouter.get("/:id/emails", async (req, res, next) => {
  try {
    const { data: profile } = await supabaseAdmin.from("customer_profiles").select("email").eq("id", req.params.id).maybeSingle();
    if (!profile) throw HttpError.notFound("Customer not found");

    const { data: orders } = await supabaseAdmin.from("orders").select("id").eq("customer_id", req.params.id);
    const orderIds = (orders ?? []).map((o: any) => o.id);

    let query = supabaseAdmin.from("email_logs").select("*").order("sent_at", { ascending: false });
    if (orderIds.length > 0 && profile.email) {
      query = query.or(`order_id.in.(${orderIds.join(",")}),recipient.eq.${profile.email}`);
    } else if (orderIds.length > 0) {
      query = query.in("order_id", orderIds);
    } else if (profile.email) {
      query = query.eq("recipient", profile.email);
    } else {
      res.json([]);
      return;
    }

    const { data, error } = await query;
    if (error) throw HttpError.internal(error.message);

    res.json(
      (data ?? []).map((l: any) => ({
        id: l.id,
        type: l.type,
        recipient: l.recipient,
        orderId: l.order_id,
        subject: l.subject,
        status: l.status,
        errorMessage: l.error_message,
        sentAt: l.sent_at,
      }))
    );
  } catch (err) {
    next(err);
  }
});
