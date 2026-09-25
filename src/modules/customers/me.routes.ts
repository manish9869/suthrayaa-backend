import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../../config/supabase.js";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { HttpError } from "../../lib/httpError.js";
import { PRODUCT_SELECT, toProductDTO } from "../catalog/serializers.js";
import { isValidIndianMobile, isValidIndianPincode, isValidIndianState, normalizeIndianMobile } from "../settings/india.data.js";
import { createInvoiceForOrder, getInvoiceForOrder, renderInvoicePdf } from "../invoices/invoice.service.js";
import { createPaymentForExistingOrder } from "../checkout/checkout.service.js";
import { buildOrderEmailData } from "../admin/admin.orders.routes.js";
import { sendTemplatedEmail, storeLinkVariables } from "../email/email.service.js";
import { env } from "../../config/env.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const meRouter = Router();
meRouter.use(authenticate);

// ---- Profile ----

function toProfileDTO(row: any, fallbackEmail?: string) {
  return {
    id: row.id,
    email: row.email ?? fallbackEmail ?? null,
    phone: row.phone ?? null,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    marketingOptIn: Boolean(row.marketing_opt_in),
    createdAt: row.created_at,
  };
}

meRouter.get("/", async (req, res, next) => {
  try {
    let { data, error } = await supabaseAdmin.from("customer_profiles").select("*").eq("id", req.user!.id).maybeSingle();
    if (error) throw HttpError.internal(error.message);
    // Accounts created before the profile trigger existed have no row yet — create it lazily
    if (!data) {
      const created = await supabaseAdmin
        .from("customer_profiles")
        .upsert({ id: req.user!.id, email: req.user!.email ?? null, phone: req.user!.phone ?? null }, { onConflict: "id" })
        .select("*")
        .single();
      data = created.data;
    }
    res.json(data ? toProfileDTO(data, req.user!.email) : null);
  } catch (err) {
    next(err);
  }
});

const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(60).optional(),
  lastName: z.string().trim().min(1, "Last name is required").max(60).optional(),
  phone: z
    .string()
    .refine((v) => v === "" || isValidIndianMobile(v), "Enter a valid 10-digit Indian mobile number")
    .transform((v) => (v ? normalizeIndianMobile(v) : ""))
    .optional(),
  marketingOptIn: z.boolean().optional(),
});

meRouter.patch("/", validate(updateProfileSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof updateProfileSchema>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.firstName !== undefined) update.first_name = body.firstName;
    if (body.lastName !== undefined) update.last_name = body.lastName;
    if (body.phone !== undefined) update.phone = body.phone || null;
    if (body.marketingOptIn !== undefined) update.marketing_opt_in = body.marketingOptIn;
    const { data, error } = await supabaseAdmin
      .from("customer_profiles")
      .upsert({ id: req.user!.id, email: req.user!.email ?? null, ...update }, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.json(toProfileDTO(data, req.user!.email));
  } catch (err) {
    next(err);
  }
});

// ---- Addresses ----

function toAddressDTO(a: any) {
  return {
    id: a.id,
    label: a.label ?? null,
    firstName: a.first_name,
    lastName: a.last_name,
    phone: a.phone,
    addressLine1: a.address_line1,
    addressLine2: a.address_line2 ?? null,
    landmark: a.landmark ?? null,
    city: a.city,
    district: a.district ?? null,
    state: a.state,
    pincode: a.pincode,
    addressType: a.address_type ?? null,
    isDefault: Boolean(a.is_default),
    isDefaultBilling: Boolean(a.is_default_billing),
    createdAt: a.created_at,
  };
}

async function listAddresses(customerId: string) {
  const { data, error } = await supabaseAdmin
    .from("addresses")
    .select("*")
    .eq("customer_id", customerId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw HttpError.internal(error.message);
  return data ?? [];
}

/** Keeps exactly one default shipping (and billing) address whenever any address exists. */
async function ensureDefaults(customerId: string) {
  const rows = await listAddresses(customerId);
  if (!rows.length) return;
  if (!rows.some((r: any) => r.is_default)) {
    await supabaseAdmin.from("addresses").update({ is_default: true }).eq("id", rows[0].id);
  }
  if (!rows.some((r: any) => r.is_default_billing)) {
    const shipDefault = rows.find((r: any) => r.is_default) ?? rows[0];
    await supabaseAdmin.from("addresses").update({ is_default_billing: true }).eq("id", shipDefault.id);
  }
}

meRouter.get("/addresses", async (req, res, next) => {
  try {
    res.json((await listAddresses(req.user!.id)).map(toAddressDTO));
  } catch (err) {
    next(err);
  }
});

const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  firstName: z.string().trim().min(1, "First name is required").max(60),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  phone: z.string().refine(isValidIndianMobile, "Enter a valid 10-digit Indian mobile number").transform(normalizeIndianMobile),
  addressLine1: z.string().trim().min(3, "Enter your house / street address").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, "Enter your city").max(80),
  district: z.string().trim().max(80).optional(),
  state: z.string().refine(isValidIndianState, "Select a valid Indian state or union territory"),
  pincode: z.string().refine(isValidIndianPincode, "Enter a valid 6-digit PIN code"),
  addressType: z.enum(["home", "work", "other"]).optional(),
  isDefault: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
});

function addressRow(body: Partial<z.infer<typeof addressSchema>>) {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    label: "label",
    firstName: "first_name",
    lastName: "last_name",
    phone: "phone",
    addressLine1: "address_line1",
    addressLine2: "address_line2",
    landmark: "landmark",
    city: "city",
    district: "district",
    state: "state",
    pincode: "pincode",
    addressType: "address_type",
    isDefault: "is_default",
    isDefaultBilling: "is_default_billing",
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (body as any)[k];
    if (v !== undefined) row[col] = v === "" ? null : v;
  }
  return row;
}

async function clearOtherDefaults(customerId: string, body: { isDefault?: boolean; isDefaultBilling?: boolean }) {
  if (body.isDefault) await supabaseAdmin.from("addresses").update({ is_default: false }).eq("customer_id", customerId);
  if (body.isDefaultBilling) await supabaseAdmin.from("addresses").update({ is_default_billing: false }).eq("customer_id", customerId);
}

meRouter.post("/addresses", validate(addressSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof addressSchema>;
    const existing = await listAddresses(req.user!.id);
    if (existing.length >= 20) throw HttpError.badRequest("You can save up to 20 addresses");
    await clearOtherDefaults(req.user!.id, body);
    const { data, error } = await supabaseAdmin
      .from("addresses")
      .insert({ customer_id: req.user!.id, ...addressRow(body) })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    await ensureDefaults(req.user!.id);
    const { data: fresh } = await supabaseAdmin.from("addresses").select("*").eq("id", data.id).single();
    res.status(201).json(toAddressDTO(fresh ?? data));
  } catch (err) {
    next(err);
  }
});

meRouter.patch("/addresses/:id", validate(addressSchema.partial()), async (req, res, next) => {
  try {
    const body = req.body as Partial<z.infer<typeof addressSchema>>;
    await clearOtherDefaults(req.user!.id, body);
    const { data, error } = await supabaseAdmin
      .from("addresses")
      .update(addressRow(body))
      .eq("id", req.params.id)
      .eq("customer_id", req.user!.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Address not found");
    await ensureDefaults(req.user!.id);
    const { data: fresh } = await supabaseAdmin.from("addresses").select("*").eq("id", data.id).single();
    res.json(toAddressDTO(fresh ?? data));
  } catch (err) {
    next(err);
  }
});

meRouter.delete("/addresses/:id", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("addresses").delete().eq("id", req.params.id).eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    // Deleting the default promotes the next address so checkout always has one preselected
    await ensureDefaults(req.user!.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Orders (history) ----

const CANCELLABLE = ["pending_payment", "confirmed"];

function toOrderSummaryDTO(o: any) {
  const items = (o.order_items ?? []) as any[];
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    paymentStatus: o.payment_status,
    paymentMethod: o.payment_method,
    total: Number(o.total),
    itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
    previewItems: items.slice(0, 4).map((i: any) => ({ name: i.product_name_snapshot, image: i.product_image_snapshot ?? null })),
    placedAt: o.placed_at,
    createdAt: o.created_at,
    canCancel: CANCELLABLE.includes(o.status),
    canPay: o.status === "pending_payment" && o.payment_method === "razorpay" && o.payment_status !== "paid",
  };
}

function toOrderDetailDTO(o: any, invoiceNumber: string | null) {
  return {
    ...toOrderSummaryDTO(o),
    subtotal: Number(o.subtotal),
    discountAmount: Number(o.discount_amount),
    couponCode: o.coupons?.code ?? null,
    shippingCost: Number(o.shipping_cost),
    giftWrapCost: Number(o.gift_wrap_cost),
    taxAmount: Number(o.tax_amount ?? 0),
    cgstAmount: Number(o.cgst_amount ?? 0),
    sgstAmount: Number(o.sgst_amount ?? 0),
    igstAmount: Number(o.igst_amount ?? 0),
    shippingAddress: o.shipping_address,
    billingAddress: o.billing_address ?? null,
    shippingMethod: o.shipping_method,
    giftWrap: o.gift_wrap,
    giftMessage: o.gift_message,
    trackingNumber: o.tracking_number ?? null,
    courier: o.courier ?? null,
    paymentReference: o.razorpay_payment_id ?? null,
    invoiceNumber,
    invoiceAvailable: Boolean(invoiceNumber) || (o.status !== "pending_payment" && o.status !== "cancelled") || o.payment_status === "paid",
    items: (o.order_items ?? []).map((i: any) => ({
      id: i.id,
      productId: i.product_id,
      productSlug: i.products?.slug ?? null,
      name: i.product_name_snapshot,
      sku: i.product_sku_snapshot ?? null,
      image: i.product_image_snapshot,
      unitPrice: Number(i.unit_price_snapshot),
      quantity: i.quantity,
      lineTotal: Number(i.line_total),
      selectedColor: i.selected_color_hex,
      selectedColorName: i.selected_color_name ?? null,
      customText: i.custom_text,
      customizations: (i.customizations ?? []).map((c: any) => ({
        label: c.label,
        value: c.valueLabel ?? c.textValue ?? "",
        priceAdjustment: Number(c.priceAdjustment ?? 0),
      })),
    })),
    statusHistory: (o.order_status_history ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((h: any) => ({ status: h.status, note: h.note, at: h.created_at })),
  };
}

async function loadOwnOrder(orderId: string, customerId: string) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*, products(slug)), order_status_history(*), coupons(code)")
    .eq("id", orderId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw HttpError.internal(error.message);
  if (!data) throw HttpError.notFound("Order not found");
  return data;
}

meRouter.get("/orders", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("customer_id", req.user!.id)
      .order("created_at", { ascending: false });
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toOrderSummaryDTO));
  } catch (err) {
    next(err);
  }
});

meRouter.get("/orders/:id", async (req, res, next) => {
  try {
    const order = await loadOwnOrder(req.params.id, req.user!.id);
    const invoice = await getInvoiceForOrder(order.id);
    res.json(toOrderDetailDTO(order, invoice?.invoice_number ?? null));
  } catch (err) {
    next(err);
  }
});

/** The order's invoice as a PDF — generated on first request once the order is confirmed. */
meRouter.get("/orders/:id/invoice", async (req, res, next) => {
  try {
    const order = await loadOwnOrder(req.params.id, req.user!.id);
    let invoice = await getInvoiceForOrder(order.id);
    if (!invoice) {
      if (order.status === "pending_payment" || (order.status === "cancelled" && order.payment_status !== "paid")) {
        throw HttpError.badRequest("Your invoice will be available once the order is confirmed");
      }
      invoice = await createInvoiceForOrder(order.id);
    }
    const pdf = await renderInvoicePdf(invoice.invoice_number, invoice.snapshot, order.status, order.payment_status);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoice_number}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

const cancelSchema = z.object({ reason: z.string().trim().max(300).optional() });

/** Customers can cancel until making starts (awaiting payment or confirmed). */
meRouter.post("/orders/:id/cancel", validate(cancelSchema), async (req, res, next) => {
  try {
    const { reason } = req.body as z.infer<typeof cancelSchema>;
    const order = await loadOwnOrder(req.params.id, req.user!.id);
    if (!CANCELLABLE.includes(order.status)) {
      throw HttpError.badRequest("This order is already being made and can't be cancelled online — please contact us");
    }
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .in("status", CANCELLABLE);
    if (error) throw HttpError.internal(error.message);
    await supabaseAdmin.from("order_status_history").insert({
      order_id: order.id,
      status: "cancelled",
      note: `Cancelled by customer${reason ? `: ${reason}` : ""}`,
    });

    // Return reserved stock (COD reserves at placement, online orders once paid)
    if (order.payment_method === "cod" || order.payment_status === "paid") {
      for (const item of order.order_items ?? []) {
        if (item.product_id) await supabaseAdmin.rpc("increment_product_stock", { p_product_id: item.product_id, p_qty: item.quantity });
      }
    }

    const fresh = await loadOwnOrder(order.id, req.user!.id);
    const to = fresh.guest_email ?? fresh.shipping_address?.email ?? req.user!.email;
    if (to) {
      const { variables, listVariables, rawVariables } = buildOrderEmailData(fresh);
      sendTemplatedEmail({ type: "order_cancelled", to, variables, rawVariables, listVariables, relatedOrderId: fresh.id }).catch(() => {});
    }
    if (env.ADMIN_NOTIFICATION_EMAIL) {
      sendTemplatedEmail({
        type: "admin_new_enquiry",
        to: env.ADMIN_NOTIFICATION_EMAIL,
        variables: {
          customer_name: `${fresh.shipping_address?.firstName ?? ""} ${fresh.shipping_address?.lastName ?? ""}`.trim() || "A customer",
          customer_email: to ?? "no email on file",
          ...storeLinkVariables(),
        },
        rawVariables: {
          enquiry_message: `<strong>Order ${fresh.order_number} was cancelled by the customer.</strong>${reason ? `<br/><br/>Reason: ${reason.replace(/[<>&]/g, "")}` : ""}${fresh.payment_status === "paid" ? "<br/><br/>This order was paid online — please process the refund." : ""}`,
        },
        relatedOrderId: fresh.id,
      }).catch(() => {});
    }

    const invoice = await getInvoiceForOrder(fresh.id);
    res.json(toOrderDetailDTO(fresh, invoice?.invoice_number ?? null));
  } catch (err) {
    next(err);
  }
});

/** Starts a new online payment for an order still awaiting payment. */
meRouter.post("/orders/:id/pay", async (req, res, next) => {
  try {
    const { order, razorpayOrder } = await createPaymentForExistingOrder(req.params.id, req.user!.id);
    res.json({
      order: { id: order.id, orderNumber: order.order_number, total: Number(order.total) },
      razorpay: { orderId: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, keyId: env.RAZORPAY_KEY_ID },
    });
  } catch (err) {
    next(err);
  }
});

// ---- Wishlist ----

meRouter.get("/wishlist", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("wishlist_items")
      .select(`product_id, products(${PRODUCT_SELECT})`)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map((w: any) => (w.products ? toProductDTO(w.products) : null)).filter(Boolean));
  } catch (err) {
    next(err);
  }
});

meRouter.post("/wishlist/:productId", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("wishlist_items")
      .upsert(
        { customer_id: req.user!.id, product_id: req.params.productId },
        { onConflict: "customer_id,product_id" }
      );
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

meRouter.delete("/wishlist/:productId", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("wishlist_items")
      .delete()
      .eq("customer_id", req.user!.id)
      .eq("product_id", req.params.productId);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Cart (server sync for logged-in users; guests stay on the existing localStorage cart) ----

/** Resolves stored {customizationId, valueId, textValue} selections against the
 * product's current groups/values so the cart can display labels, not raw IDs. */
function resolveCartCustomizations(product: any, selections: any[]) {
  if (!selections?.length) return [];
  const groups = product.customizations ?? [];
  return selections
    .map((s: any) => {
      const group = groups.find((g: any) => g.id === s.customizationId);
      if (!group) return null;
      const value = group.values.find((v: any) => v.id === s.valueId);
      return {
        customizationId: group.id,
        label: group.label,
        valueLabel: value?.label,
        textValue: s.textValue,
        priceAdjustment: value?.priceAdjustment ?? 0,
      };
    })
    .filter(Boolean);
}

function toCartItemDTO(row: any) {
  const product = row.products ? toProductDTO(row.products) : null;
  return {
    id: row.id,
    product,
    quantity: row.quantity,
    selectedColor: row.selected_color_hex || undefined,
    customText: row.custom_text || undefined,
    customizations: product ? resolveCartCustomizations(product, row.customizations ?? []) : [],
  };
}

meRouter.get("/cart", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("cart_items")
      .select(`*, products(${PRODUCT_SELECT})`)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toCartItemDTO).filter((c) => c.product));
  } catch (err) {
    next(err);
  }
});

const cartSyncSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().min(1).max(20),
      selectedColor: z.string().optional(),
      customText: z.string().max(200).optional(),
      customizations: z
        .array(
          z.object({
            customizationId: z.string().uuid(),
            valueId: z.string().uuid().optional(),
            textValue: z.string().max(1000).optional(),
          })
        )
        .optional(),
    })
  ),
});

// Merges the client's (possibly guest) cart into the server cart — additive union keyed on
// product+color+customText, mirroring the key logic in the frontend's Zustand cart store.
meRouter.put("/cart", validate(cartSyncSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof cartSyncSchema>;

    for (const item of body.items) {
      const colorKey = item.selectedColor ?? "";
      const textKey = item.customText ?? "";
      const customizations = item.customizations ?? [];

      const { data: existing } = await supabaseAdmin
        .from("cart_items")
        .select("id, quantity")
        .eq("customer_id", req.user!.id)
        .eq("product_id", item.productId)
        .eq("selected_color_hex", colorKey)
        .eq("custom_text", textKey)
        .eq("customizations", JSON.stringify(customizations))
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from("cart_items")
          .update({ quantity: existing.quantity + item.quantity })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("cart_items").insert({
          customer_id: req.user!.id,
          product_id: item.productId,
          quantity: item.quantity,
          selected_color_hex: colorKey,
          custom_text: textKey,
          customizations,
        });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("cart_items")
      .select(`*, products(${PRODUCT_SELECT})`)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toCartItemDTO).filter((c) => c.product));
  } catch (err) {
    next(err);
  }
});

meRouter.delete("/cart/:itemId", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("cart_items")
      .delete()
      .eq("id", req.params.itemId)
      .eq("customer_id", req.user!.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

meRouter.delete("/cart", async (req, res, next) => {
  try {
    await supabaseAdmin.from("cart_items").delete().eq("customer_id", req.user!.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
