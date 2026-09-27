import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { can } from "../../modules/rbac/rbac.service.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { logAudit } from "../rbac/audit.service.js";
import { sendTemplatedEmail, ORDER_EMAIL_TYPES, storeLinkVariables, renderOrderDetailsHtml, renderAddressHtml } from "../email/email.service.js";
import { formatPrice } from "../../lib/format.js";
import { createInvoiceForOrder, getInvoiceForOrder, renderInvoicePdf } from "../invoices/invoice.service.js";
import { env } from "../../config/env.js";
import { getSettingSync } from "../settings/settings.service.js";
import { background } from "../../lib/background.js";
import { razorpay } from "../../config/razorpay.js";
import { restoreOrderStock } from "../checkout/checkout.service.js";

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

adminOrdersRouter.get("/", requirePermission("orders.view"), async (req, res, next) => {
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

adminOrdersRouter.get("/:id", requirePermission("orders.view"), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*), order_status_history(*), order_refunds(*)")
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Order not found");

    const invoice = await getInvoiceForOrder(data.id);
    // Registered customers have no guest_email on the order — look up their login email
    let customerEmail: string | null = data.guest_email ?? null;
    if (!customerEmail && data.customer_id) {
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.customer_id);
        customerEmail = u?.user?.email ?? null;
      } catch {
        customerEmail = null;
      }
    }

    res.json({
      ...toAdminOrderSummary(data),
      subtotal: Number(data.subtotal),
      discountAmount: Number(data.discount_amount),
      shippingCost: Number(data.shipping_cost),
      giftWrapCost: Number(data.gift_wrap_cost),
      shippingAddress: data.shipping_address,
      billingAddress: data.billing_address ?? null,
      shippingMethod: data.shipping_method,
      guestEmail: data.guest_email,
      customerEmail,
      guestPhone: data.guest_phone,
      razorpayOrderId: data.razorpay_order_id,
      razorpayPaymentId: data.razorpay_payment_id,
      courier: data.courier,
      adminNotes: data.admin_notes,
      customerNotes: data.customer_notes,
      invoiceNumber: invoice?.invoice_number ?? null,
      refundedAmount: Number(data.refunded_amount ?? 0),
      refunds: (data.order_refunds ?? [])
        .slice()
        .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map(toRefundDTO),
      allowedStatuses: ORDER_TRANSITIONS[data.status as OrderStatus] ?? [],
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

/** Builds the full variable set every order-lifecycle email template can draw from — the
 * "standard" fields (customer_name, order_number, ...) plus everything the richer
 * custom_order_confirmation template needs (line items, payment/shipping detail, store links).
 * Templates that don't reference a given {{var}} simply ignore it, so one comprehensive set
 * is passed regardless of which template type is actually being sent. */
export function buildOrderEmailData(order: any) {
  const items = (order.order_items ?? []) as any[];
  const addr = order.shipping_address ?? {};
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);
  const discountAmount = Number(order.discount_amount ?? 0);
  const taxAmount = Number(order.tax_amount ?? 0);

  const instagramUrl = getSettingSync<boolean>("social.instagram_enabled") ? getSettingSync<string>("social.instagram_url") : "";
  const facebookUrl = getSettingSync<boolean>("social.facebook_enabled") ? getSettingSync<string>("social.facebook_url") : "";

  const variables: Record<string, string> = {
    customer_name: addr.firstName ? `${addr.firstName} ${addr.lastName ?? ""}`.trim() : "there",
    order_number: order.order_number,
    order_total: formatPrice(Number(order.total)),
    tracking_number: order.tracking_number ?? "",
    store_name: getSettingSync<string>("store.name"),
    item_count: String(itemCount),
    subtotal: formatPrice(Number(order.subtotal)),
    has_discount: String(discountAmount > 0),
    discount: formatPrice(discountAmount),
    coupon_code: order.coupons?.code ?? "",
    shipping: formatPrice(Number(order.shipping_cost ?? 0)),
    has_tax: String(taxAmount > 0),
    tax: formatPrice(taxAmount),
    total: formatPrice(Number(order.total)),
    payment_status: order.payment_status === "paid" ? "Paid" : order.payment_status === "refunded" ? "Refunded" : order.payment_status === "failed" ? "Failed" : "Pending",
    payment_method: order.payment_method === "cod" ? "Cash on Delivery" : "Online Payment",
    shipping_name: addr.firstName ? `${addr.firstName} ${addr.lastName ?? ""}`.trim() : "",
    shipping_address_line1: addr.addressLine1 ?? "",
    shipping_address_line2: addr.addressLine2 ?? "",
    shipping_city: addr.city ?? "",
    shipping_state: addr.state ?? "",
    shipping_pincode: addr.pincode ?? "",
    shipping_country: addr.country ?? getSettingSync<string>("store.country"),
    shipping_phone: addr.phone ?? "",
    order_url: `${env.FRONTEND_URL}/order-confirmation?order=${order.order_number}`,
    store_url: env.FRONTEND_URL,
    support_url: `${env.FRONTEND_URL}/faqs`,
    contact_url: `${env.FRONTEND_URL}/contact`,
    instagram_url: instagramUrl,
    facebook_url: facebookUrl,
    refund_status: order.payment_status === "refunded" ? "Refunded" : "",
    refund_amount: order.payment_status === "refunded" ? formatPrice(Number(order.total)) : "",
    current_year: String(new Date().getFullYear()),
  };

  const listVariables = {
    order_items: items.map((i: any) => ({
      product_image: i.product_image_snapshot ?? "",
      product_name: i.product_name_snapshot,
      variant_name: i.selected_color_name ?? "",
      quantity: String(i.quantity),
      item_total: formatPrice(Number(i.line_total)),
      has_discount: "false",
      original_item_total: "",
    })),
  };

  // The same items card + address block checkout emails use, so templates like order_placed
  // render fully when an admin (re)sends them from the order page.
  const rawVariables = {
    items_table: renderOrderDetailsHtml({
      orderNumber: order.order_number,
      customerName: variables.customer_name,
      paymentMethod: order.payment_method,
      subtotal: Number(order.subtotal),
      discountAmount,
      shippingCost: Number(order.shipping_cost ?? 0),
      giftWrapCost: Number(order.gift_wrap_cost ?? 0),
      total: Number(order.total),
      shippingAddress: addr,
      items: items.map((i: any) => ({
        name: i.product_name_snapshot,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price_snapshot),
        lineTotal: Number(i.line_total),
        selectedColorName: i.selected_color_name,
        customText: i.custom_text,
      })),
    }),
    address_block: addr.addressLine1 ? renderAddressHtml(addr) : "",
  };

  return { variables, listVariables, rawVariables };
}

const ORDER_STATUSES = ["pending_payment", "confirmed", "in_production", "ready", "shipped", "delivered", "cancelled", "refunded", "partially_refunded"] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Where an order may go next from each status. Payment moves pending_payment → confirmed
 * (never an admin — that would confirm an unpaid order), and refunded / partially_refunded
 * are reached only through the refund action, which actually moves money.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["cancelled"],
  confirmed: ["in_production", "ready", "shipped", "delivered", "cancelled"],
  in_production: ["confirmed", "ready", "shipped", "delivered", "cancelled"],
  ready: ["confirmed", "in_production", "shipped", "delivered", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  refunded: [],
  partially_refunded: ["in_production", "ready", "shipped", "delivered"],
};

// Templates to fire when an order moves into each status — "New"/pending_payment and
// partially_refunded have no dedicated template in this pass.
const STATUS_EMAIL_TYPE: Partial<Record<OrderStatus, string>> = {
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
  trackingNumber: z.string().max(100).optional().nullable(),
  courier: z.string().max(100).optional().nullable(),
});

adminOrdersRouter.patch("/:id/status", requirePermission("orders.update"), validate(statusUpdateSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof statusUpdateSchema>;
    const { data: current, error: loadError } = await supabaseAdmin
      .from("orders")
      .select("id, status, payment_status, payment_method")
      .eq("id", req.params.id)
      .maybeSingle();
    if (loadError) throw HttpError.internal(loadError.message);
    if (!current) throw HttpError.notFound("Order not found");

    const shippingUpdate: Record<string, unknown> = {};
    if (body.trackingNumber !== undefined) shippingUpdate.tracking_number = body.trackingNumber;
    if (body.courier !== undefined) shippingUpdate.courier = body.courier;

    // Same status: just the courier / tracking fields — no history entry, no repeat email
    if (body.status === current.status) {
      if (Object.keys(shippingUpdate).length) {
        const { error } = await supabaseAdmin.from("orders").update(shippingUpdate).eq("id", current.id);
        if (error) throw HttpError.internal(error.message);
      }
      res.json({ ok: true });
      return;
    }

    if (body.status === "refunded" || body.status === "partially_refunded") {
      throw HttpError.badRequest("Use the Refund action to refund an order — it records the refund and returns the money.");
    }
    if (!ORDER_TRANSITIONS[current.status as OrderStatus]?.includes(body.status)) {
      throw HttpError.badRequest(`An order that is ${current.status.replace(/_/g, " ")} can't be moved to ${body.status.replace(/_/g, " ")}.`);
    }
    if (body.status === "cancelled" && !can(req.rbac!, "orders.cancel")) {
      throw HttpError.forbidden("You do not have permission to cancel orders.");
    }

    const update: Record<string, unknown> = { ...shippingUpdate, status: body.status };
    // Cash on Delivery is collected at the door — delivery is when it becomes revenue
    const codCollected = body.status === "delivered" && current.payment_method === "cod" && current.payment_status === "pending";
    if (codCollected) {
      update.payment_status = "paid";
      update.paid_at = new Date().toISOString();
    }

    // Conditional on the status we validated against, so a concurrent change can't be skipped over
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .update(update)
      .eq("id", current.id)
      .eq("status", current.status)
      .select("*, order_items(*), coupons(code)")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!order) throw HttpError.conflict("This order was just updated by someone else — please refresh and try again");

    const refundRequired = body.status === "cancelled" && order.payment_status === "paid";
    await supabaseAdmin.from("order_status_history").insert({
      order_id: order.id,
      status: body.status,
      note: [body.note, codCollected ? "Cash on Delivery collected" : null, refundRequired ? "Paid online — refund required" : null].filter(Boolean).join(" · ") || null,
      changed_by: req.admin!.id,
    });

    if (body.status === "cancelled") await restoreOrderStock(order.id);

    const emailType = STATUS_EMAIL_TYPE[body.status];
    const customerEmail = order.guest_email ?? order.shipping_address?.email;
    if (emailType && customerEmail) {
      const { variables, listVariables, rawVariables } = buildOrderEmailData(order);
      background(sendTemplatedEmail({
        type: emailType,
        to: customerEmail,
        variables,
        rawVariables,
        listVariables,
        relatedOrderId: order.id,
      }).catch(() => {}));
    }

    await logAudit({
      userId: req.admin!.id,
      action: body.status === "cancelled" ? "ORDER_CANCELLED" : "ORDER_UPDATED",
      resource: "orders",
      resourceId: order.id,
      permission: body.status === "cancelled" ? "orders.cancel" : "orders.update",
      metadata: { orderNumber: order.order_number, from: current.status, to: body.status, ...(codCollected ? { paymentStatus: "paid" } : {}) },
      req,
    });
    res.json({ ok: true, refundRequired });
  } catch (err) {
    next(err);
  }
});

// ---- Refunds ----
// Full or partial. Online payments are refunded through Razorpay; COD / offline money is
// recorded as a manual refund. refunded_amount is claimed with an optimistic lock before the
// gateway call, so two admins (or a double click) can never refund the same money twice.

const refundSchema = z.object({
  amount: z.number().positive().multipleOf(0.01).optional(),
  reason: z.string().trim().min(1, "Please give a reason").max(500),
  restock: z.boolean().optional(),
});

adminOrdersRouter.post("/:id/refund", requirePermission("orders.refund"), validate(refundSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof refundSchema>;
    const { data: order, error: loadError } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*), coupons(code)")
      .eq("id", req.params.id)
      .maybeSingle();
    if (loadError) throw HttpError.internal(loadError.message);
    if (!order) throw HttpError.notFound("Order not found");
    if (order.payment_status !== "paid" && order.payment_status !== "partially_refunded") {
      throw HttpError.badRequest("Only paid orders can be refunded");
    }

    const total = Number(order.total);
    const alreadyRefunded = Number(order.refunded_amount ?? 0);
    const remaining = Math.round((total - alreadyRefunded) * 100) / 100;
    const amount = Math.round((body.amount ?? remaining) * 100) / 100;
    if (remaining <= 0) throw HttpError.badRequest("This order has already been fully refunded");
    if (amount > remaining) throw HttpError.badRequest(`At most ${formatPrice(remaining)} can still be refunded on this order`);

    const newRefunded = Math.round((alreadyRefunded + amount) * 100) / 100;
    const isFull = newRefunded >= total;
    // Items that never left can go back on the shelf; after shipping it's the admin's call
    // (a return has to physically arrive first). Stock only comes back with a full refund.
    const restock = isFull && (body.restock ?? !["shipped", "delivered"].includes(order.status));

    const { data: claimed } = await supabaseAdmin
      .from("orders")
      .update({ refunded_amount: newRefunded })
      .eq("id", order.id)
      .eq("refunded_amount", order.refunded_amount ?? 0)
      .select("id");
    if (!claimed?.length) throw HttpError.conflict("Another refund on this order is in progress — please refresh and try again");

    const viaGateway = order.payment_method === "razorpay" && Boolean(order.razorpay_payment_id);
    let gatewayRefund: { id: string; status: string } | null = null;
    if (viaGateway) {
      try {
        gatewayRefund = (await razorpay.payments.refund(order.razorpay_payment_id, {
          amount: Math.round(amount * 100),
          notes: { orderId: order.id, orderNumber: order.order_number, reason: body.reason.slice(0, 200) },
        })) as unknown as { id: string; status: string };
      } catch (err) {
        await supabaseAdmin.from("orders").update({ refunded_amount: alreadyRefunded }).eq("id", order.id).eq("refunded_amount", newRefunded);
        const description = (err as { error?: { description?: string } })?.error?.description;
        throw new HttpError(422, `Razorpay refused the refund${description ? `: ${description}` : ""}. Nothing was refunded.`, "GATEWAY_ERROR");
      }
    }

    const { data: refund } = await supabaseAdmin
      .from("order_refunds")
      .insert({
        order_id: order.id,
        amount,
        method: viaGateway ? "razorpay" : "manual",
        razorpay_refund_id: gatewayRefund?.id ?? null,
        status: gatewayRefund && gatewayRefund.status !== "processed" ? "pending" : "processed",
        reason: body.reason,
        restocked: restock,
        created_by: req.admin!.id,
      })
      .select("*")
      .single();

    const statusUpdate: Record<string, unknown> = { payment_status: isFull ? "refunded" : "partially_refunded" };
    if (isFull) statusUpdate.status = "refunded";
    await supabaseAdmin.from("orders").update(statusUpdate).eq("id", order.id);
    await supabaseAdmin.from("order_status_history").insert({
      order_id: order.id,
      status: isFull ? "refunded" : order.status,
      note: `${isFull ? "Refunded" : "Partially refunded"} ${formatPrice(amount)}${viaGateway ? " via Razorpay" : " (manual)"} — ${body.reason}${restock ? " · stock returned" : ""}`,
      changed_by: req.admin!.id,
    });
    if (restock) await restoreOrderStock(order.id);

    const customerEmail = order.guest_email ?? order.shipping_address?.email;
    if (customerEmail) {
      const { variables, listVariables, rawVariables } = buildOrderEmailData({ ...order, payment_status: statusUpdate.payment_status });
      background(sendTemplatedEmail({
        type: "refund_processed",
        to: customerEmail,
        variables: { ...variables, refund_status: isFull ? "Refunded" : "Partially refunded", refund_amount: formatPrice(amount) },
        rawVariables,
        listVariables,
        relatedOrderId: order.id,
      }).catch(() => {}));
    }

    await logAudit({
      userId: req.admin!.id,
      action: "ORDER_REFUNDED",
      resource: "orders",
      resourceId: order.id,
      permission: "orders.refund",
      metadata: {
        orderNumber: order.order_number,
        amount,
        full: isFull,
        method: viaGateway ? "razorpay" : "manual",
        razorpayRefundId: gatewayRefund?.id ?? null,
        refundedBefore: alreadyRefunded,
        refundedAfter: newRefunded,
        restocked: restock,
      },
      req,
    });

    res.status(201).json({ refund: refund ? toRefundDTO(refund) : null, refundedAmount: newRefunded, paymentStatus: statusUpdate.payment_status });
  } catch (err) {
    next(err);
  }
});

function toRefundDTO(r: any) {
  return {
    id: r.id,
    amount: Number(r.amount),
    method: r.method,
    razorpayRefundId: r.razorpay_refund_id,
    status: r.status,
    reason: r.reason,
    restocked: r.restocked,
    createdAt: r.created_at,
  };
}

const notesSchema = z.object({ adminNotes: z.string().max(2000).optional().nullable(), customerNotes: z.string().max(2000).optional().nullable() });
adminOrdersRouter.patch("/:id/notes", requirePermission("orders.update"), validate(notesSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof notesSchema>;
    const update: Record<string, unknown> = {};
    if (body.adminNotes !== undefined) update.admin_notes = body.adminNotes;
    if (body.customerNotes !== undefined) update.customer_notes = body.customerNotes;
    const { data: updated, error } = await supabaseAdmin.from("orders").update(update).eq("id", req.params.id).select("id, order_number");
    if (error) throw HttpError.internal(error.message);
    if (!updated?.length) throw HttpError.notFound("Order not found");
    await logAudit({
      userId: req.admin!.id,
      action: "ORDER_UPDATED",
      resource: "orders",
      resourceId: req.params.id,
      permission: "orders.update",
      metadata: { orderNumber: updated[0].order_number, notesUpdated: Object.keys(update) },
      req,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Manual email send ----
// Lets an admin send any order-lifecycle email on demand, independent of the order's actual
// status — e.g. resending a notification, or nudging "tracking updated" without a status change.

const sendEmailSchema = z.object({ type: z.enum(ORDER_EMAIL_TYPES) });
adminOrdersRouter.post("/:id/send-email", requirePermission("orders.update"), validate(sendEmailSchema), async (req, res, next) => {
  try {
    const { type } = req.body as z.infer<typeof sendEmailSchema>;
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*), coupons(code)")
      .eq("id", req.params.id)
      .single();
    if (!order) throw HttpError.notFound("Order not found");

    const to = order.guest_email ?? order.shipping_address?.email;
    if (!to) throw HttpError.badRequest("This order has no email address on file");

    const { variables, listVariables, rawVariables } = buildOrderEmailData(order);
    await sendTemplatedEmail({
      type,
      to,
      variables,
      rawVariables,
      listVariables,
      relatedOrderId: order.id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Invoice actions ----

adminOrdersRouter.get("/:id/invoice", requirePermission("orders.view"), async (req, res, next) => {
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

adminOrdersRouter.post("/:id/invoice/regenerate", requirePermission("orders.update"), async (req, res, next) => {
  try {
    let invoice = await getInvoiceForOrder(req.params.id);
    if (!invoice) invoice = await createInvoiceForOrder(req.params.id);
    res.json({ invoiceNumber: invoice.invoice_number });
  } catch (err) {
    next(err);
  }
});

adminOrdersRouter.get("/:id/invoice/pdf", requirePermission("orders.view"), async (req, res, next) => {
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

adminOrdersRouter.post("/:id/invoice/email", requirePermission("orders.update"), async (req, res, next) => {
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
        order_total: formatPrice(Number(order.total)),
        invoice_number: invoice.invoice_number,
        store_name: "Suthrayaa",
        order_url: `${env.FRONTEND_URL}/order-confirmation?order=${order.order_number}`,
        ...storeLinkVariables(),
      },
      relatedOrderId: order.id,
      attachments: [{ filename: `${invoice.invoice_number}.pdf`, content: pdf }],
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
