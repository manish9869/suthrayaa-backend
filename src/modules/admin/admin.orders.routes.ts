import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { sendTemplatedEmail, ORDER_EMAIL_TYPES } from "../email/email.service.js";
import { formatPrice } from "../../lib/format.js";
import { createInvoiceForOrder, getInvoiceForOrder, renderInvoicePdf } from "../invoices/invoice.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminOrdersRouter = Router();
adminOrdersRouter.use(authenticate, requireAdmin);

function isCustomOrder(o: any): boolean {
  return (o.order_items ?? []).some((i: any) => Array.isArray(i.customizations) && i.customizations.length > 0);
}

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
    isCustomOrder: isCustomOrder(o),
    trackingNumber: o.tracking_number ?? null,
    placedAt: o.placed_at,
    createdAt: o.created_at,
  };
}

adminOrdersRouter.get("/", async (req, res, next) => {
  try {
    const { status, paymentStatus, custom, page = "1", limit = "50" } = req.query as Record<string, string>;
    let query = supabaseAdmin
      .from("orders")
      .select("*, order_items(*)", { count: "exact" })
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(300, Math.max(1, Number(limit) || 50));
    query = query.range((pageNum - 1) * limitNum, pageNum * limitNum - 1);

    const { data, error, count } = await query;
    if (error) throw HttpError.internal(error.message);

    let items = (data ?? []).map(toAdminOrderSummary);
    let total = count ?? 0;
    // Custom-order-ness lives in order_items JSON, not a queryable column — filtered
    // in-app after the page loads. Fine at this catalog's order volume.
    if (custom === "true") {
      items = items.filter((i) => i.isCustomOrder);
      total = items.length;
    } else if (custom === "false") {
      items = items.filter((i) => !i.isCustomOrder);
      total = items.length;
    }

    res.json({ items, total, page: pageNum, limit: limitNum });
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

    const invoice = await getInvoiceForOrder(data.id);

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
      courier: data.courier,
      adminNotes: data.admin_notes,
      customerNotes: data.customer_notes,
      invoiceNumber: invoice?.invoice_number ?? null,
      items: (data.order_items ?? []).map((i: any) => ({
        id: i.id,
        productId: i.product_id,
        name: i.product_name_snapshot,
        sku: i.product_sku_snapshot,
        image: i.product_image_snapshot,
        unitPrice: Number(i.unit_price_snapshot),
        quantity: i.quantity,
        lineTotal: Number(i.line_total),
        selectedColor: i.selected_color_hex,
        customText: i.custom_text,
        customizations: i.customizations ?? [],
      })),
      statusHistory: (data.order_status_history ?? [])
        .slice()
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    });
  } catch (err) {
    next(err);
  }
});

const ORDER_STATUSES = ["pending_payment", "confirmed", "in_production", "ready", "shipped", "delivered", "cancelled", "refunded", "partially_refunded"] as const;

// Templates to fire when an order moves into each status — "New"/pending_payment and
// partially_refunded have no dedicated template in this pass.
const STATUS_EMAIL_TYPE: Partial<Record<(typeof ORDER_STATUSES)[number], string>> = {
  confirmed: "order_confirmed",
  in_production: "order_making",
  ready: "order_ready",
  shipped: "order_shipped",
  delivered: "order_delivered",
  cancelled: "order_cancelled",
};

const statusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().max(500).optional(),
  trackingNumber: z.string().optional().nullable(),
  courier: z.string().optional().nullable(),
});

adminOrdersRouter.patch("/:id/status", validate(statusUpdateSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof statusUpdateSchema>;
    const update: Record<string, unknown> = { status: body.status };
    if (body.trackingNumber !== undefined) update.tracking_number = body.trackingNumber;
    if (body.courier !== undefined) update.courier = body.courier;

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .update(update)
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

    const emailType = STATUS_EMAIL_TYPE[body.status];
    const customerEmail = order.guest_email ?? order.shipping_address?.email;
    if (emailType && customerEmail) {
      sendTemplatedEmail({
        type: emailType,
        to: customerEmail,
        variables: {
          customer_name: order.shipping_address ? `${order.shipping_address.firstName} ${order.shipping_address.lastName}`.trim() : "there",
          order_number: order.order_number,
          order_total: formatPrice(Number(order.total)),
          tracking_number: order.tracking_number ?? "",
          store_name: "Suthrayaa",
        },
        relatedOrderId: order.id,
      }).catch(() => {});

      if (body.status === "cancelled" || body.status === "refunded") {
        sendTemplatedEmail({
          type: "refund_processed",
          to: customerEmail,
          variables: {
            customer_name: order.shipping_address ? `${order.shipping_address.firstName} ${order.shipping_address.lastName}`.trim() : "there",
            order_number: order.order_number,
            order_total: formatPrice(Number(order.total)),
            store_name: "Suthrayaa",
          },
          relatedOrderId: order.id,
        }).catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const notesSchema = z.object({ adminNotes: z.string().max(2000).optional().nullable(), customerNotes: z.string().max(2000).optional().nullable() });
adminOrdersRouter.patch("/:id/notes", validate(notesSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof notesSchema>;
    const update: Record<string, unknown> = {};
    if (body.adminNotes !== undefined) update.admin_notes = body.adminNotes;
    if (body.customerNotes !== undefined) update.customer_notes = body.customerNotes;
    const { error } = await supabaseAdmin.from("orders").update(update).eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Manual email send ----
// Lets an admin send any order-lifecycle email on demand, independent of the order's actual
// status — e.g. resending a notification, or nudging "tracking updated" without a status change.

const sendEmailSchema = z.object({ type: z.enum(ORDER_EMAIL_TYPES) });
adminOrdersRouter.post("/:id/send-email", validate(sendEmailSchema), async (req, res, next) => {
  try {
    const { type } = req.body as z.infer<typeof sendEmailSchema>;
    const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", req.params.id).single();
    if (!order) throw HttpError.notFound("Order not found");

    const to = order.guest_email ?? order.shipping_address?.email;
    if (!to) throw HttpError.badRequest("This order has no email address on file");

    await sendTemplatedEmail({
      type,
      to,
      variables: {
        customer_name: order.shipping_address ? `${order.shipping_address.firstName} ${order.shipping_address.lastName}`.trim() : "there",
        order_number: order.order_number,
        order_total: formatPrice(Number(order.total)),
        tracking_number: order.tracking_number ?? "",
        store_name: "Suthrayaa",
      },
      relatedOrderId: order.id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Invoice actions ----

adminOrdersRouter.get("/:id/invoice", async (req, res, next) => {
  try {
    const invoice = await getInvoiceForOrder(req.params.id);
    if (!invoice) throw HttpError.notFound("No invoice for this order yet");
    const { data: order } = await supabaseAdmin.from("orders").select("status, payment_status").eq("id", req.params.id).single();
    res.json({
      invoiceNumber: invoice.invoice_number,
      createdAt: invoice.created_at,
      snapshot: invoice.snapshot,
      orderStatus: order?.status,
      paymentStatus: order?.payment_status,
    });
  } catch (err) {
    next(err);
  }
});

adminOrdersRouter.post("/:id/invoice/regenerate", async (req, res, next) => {
  try {
    let invoice = await getInvoiceForOrder(req.params.id);
    if (!invoice) invoice = await createInvoiceForOrder(req.params.id);
    res.json({ invoiceNumber: invoice.invoice_number });
  } catch (err) {
    next(err);
  }
});

adminOrdersRouter.get("/:id/invoice/pdf", async (req, res, next) => {
  try {
    let invoice = await getInvoiceForOrder(req.params.id);
    if (!invoice) invoice = await createInvoiceForOrder(req.params.id);
    const { data: order } = await supabaseAdmin.from("orders").select("status, payment_status").eq("id", req.params.id).single();

    const pdf = await renderInvoicePdf(invoice.invoice_number, invoice.snapshot, order?.status ?? "confirmed", order?.payment_status ?? "pending");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${invoice.invoice_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

adminOrdersRouter.post("/:id/invoice/email", async (req, res, next) => {
  try {
    let invoice = await getInvoiceForOrder(req.params.id);
    if (!invoice) invoice = await createInvoiceForOrder(req.params.id);
    const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", req.params.id).single();
    if (!order) throw HttpError.notFound("Order not found");
    const to = order.guest_email ?? order.shipping_address?.email;
    if (!to) throw HttpError.badRequest("This order has no email address on file");

    const pdf = await renderInvoicePdf(invoice.invoice_number, invoice.snapshot, order.status, order.payment_status);
    await sendTemplatedEmail({
      type: "invoice_email",
      to,
      variables: {
        customer_name: order.shipping_address ? `${order.shipping_address.firstName} ${order.shipping_address.lastName}`.trim() : "there",
        order_number: order.order_number,
        invoice_number: invoice.invoice_number,
        store_name: "Suthrayaa",
      },
      relatedOrderId: order.id,
      attachments: [{ filename: `${invoice.invoice_number}.pdf`, content: pdf }],
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
