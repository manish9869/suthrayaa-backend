import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminOrdersRouter = Router();
adminOrdersRouter.use(authenticate, requireAdmin);

function toAdminOrderSummary(o: any) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    customerId: o.customer_id,
    customerName: o.shipping_address ? `${o.shipping_address.firstName} ${o.shipping_address.lastName}` : null,
    status: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    total: Number(o.total),
    itemCount: (o.order_items ?? []).reduce((s: number, i: any) => s + i.quantity, 0),
    placedAt: o.placed_at,
    createdAt: o.created_at,
  };
}

adminOrdersRouter.get("/", async (req, res, next) => {
  try {
    const { status, paymentStatus, page = "1", limit = "50" } = req.query as Record<string, string>;
    let query = supabaseAdmin
      .from("orders")
      .select("*, order_items(*)", { count: "exact" })
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    query = query.range((pageNum - 1) * limitNum, pageNum * limitNum - 1);

    const { data, error, count } = await query;
    if (error) throw HttpError.internal(error.message);

    res.json({ items: (data ?? []).map(toAdminOrderSummary), total: count ?? 0, page: pageNum, limit: limitNum });
  } catch (err) {
    next(err);
  }
});

adminOrdersRouter.get("/:id", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*), order_status_history(*)")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Order not found");

    res.json({
      ...toAdminOrderSummary(data),
      subtotal: Number(data.subtotal),
      discountAmount: Number(data.discount_amount),
      shippingCost: Number(data.shipping_cost),
      giftWrapCost: Number(data.gift_wrap_cost),
      shippingAddress: data.shipping_address,
      shippingMethod: data.shipping_method,
      guestEmail: data.guest_email,
      guestPhone: data.guest_phone,
      razorpayOrderId: data.razorpay_order_id,
      razorpayPaymentId: data.razorpay_payment_id,
      items: (data.order_items ?? []).map((i: any) => ({
        id: i.id,
        productId: i.product_id,
        name: i.product_name_snapshot,
        image: i.product_image_snapshot,
        unitPrice: Number(i.unit_price_snapshot),
        quantity: i.quantity,
        lineTotal: Number(i.line_total),
        selectedColor: i.selected_color_hex,
        customText: i.custom_text,
      })),
      statusHistory: (data.order_status_history ?? [])
        .slice()
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    });
  } catch (err) {
    next(err);
  }
});

const statusUpdateSchema = z.object({
  status: z.enum(["pending_payment", "confirmed", "in_production", "shipped", "delivered", "cancelled", "refunded"]),
  note: z.string().max(500).optional(),
});

adminOrdersRouter.patch("/:id/status", validate(statusUpdateSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof statusUpdateSchema>;
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .update({ status: body.status })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!order) throw HttpError.notFound("Order not found");

    await supabaseAdmin.from("order_status_history").insert({
      order_id: order.id,
      status: body.status,
      note: body.note,
      changed_by: req.admin!.id,
    });

    // Cancelling/refunding returns any stock that was reserved for this order.
    if ((body.status === "cancelled" || body.status === "refunded") && order.payment_status !== "refunded") {
      const { data: items } = await supabaseAdmin
        .from("order_items")
        .select("product_id, quantity")
        .eq("order_id", order.id);
      for (const item of items ?? []) {
        if (item.product_id) {
          await supabaseAdmin.rpc("increment_product_stock", { p_product_id: item.product_id, p_qty: item.quantity });
        }
      }
      if (body.status === "refunded") {
        await supabaseAdmin.from("orders").update({ payment_status: "refunded" }).eq("id", order.id);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
