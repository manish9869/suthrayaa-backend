import { randomInt } from "node:crypto";
import crypto from "node:crypto";
import { supabaseAdmin } from "../../config/supabase.js";
import { razorpay } from "../../config/razorpay.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/httpError.js";
import { logger } from "../../lib/logger.js";
import { PRODUCT_SELECT, getEffectivePrice } from "../catalog/serializers.js";
import {
  sendAdminOrderNotification,
  sendTemplatedEmail,
  renderOrderDetailsHtml,
  renderAddressHtml,
  storeLinkVariables,
} from "../email/email.service.js";
import { formatPrice } from "../../lib/format.js";
import { createInvoiceForOrder, renderInvoicePdf } from "../invoices/invoice.service.js";
import { getShippingQuote } from "../settings/shipping.service.js";
import { getSetting, getSettingsMap } from "../settings/settings.service.js";
import { computeGst } from "../settings/tax.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CustomizationSelectionInput {
  customizationId: string;
  valueId?: string;
  textValue?: string;
}

export interface CartItemInput {
  productId: string;
  quantity: number;
  selectedColor?: string;
  customText?: string;
  customizations?: CustomizationSelectionInput[];
}

export interface CustomizationSnapshot {
  customizationId: string;
  name: string;
  label: string;
  type: string;
  valueId?: string;
  valueLabel?: string;
  value?: string;
  textValue?: string;
  priceAdjustment: number;
}

interface ValidatedLine {
  productId: string;
  name: string;
  sku?: string | null;
  image?: string;
  basePrice: number;
  unitPrice: number;
  quantity: number;
  selectedColorHex?: string;
  selectedColorName?: string;
  customText?: string;
  customizations: CustomizationSnapshot[];
  lineTotal: number;
  taxCategoryId?: string | null;
}

/**
 * Resolves + validates a customer's customization selections against the product's
 * CURRENT admin-configured groups/values, and returns a priced snapshot. This is the
 * only place cart/order line prices are computed — the frontend's displayed total is
 * never trusted. Throws HttpError on any invalid/disabled/missing-required selection.
 */
function resolveCustomizations(product: any, selections: CustomizationSelectionInput[]): {
  snapshot: CustomizationSnapshot[];
  priceAdjustmentTotal: number;
} {
  const groups: any[] = (product.product_customizations ?? []).filter((g: any) => g.enabled);
  if (groups.length === 0) return { snapshot: [], priceAdjustmentTotal: 0 };

  const selectionByGroupId = new Map(selections.map((s) => [s.customizationId, s]));
  const selectedValueIds = new Set(selections.map((s) => s.valueId).filter(Boolean));

  const snapshot: CustomizationSnapshot[] = [];
  let priceAdjustmentTotal = 0;

  for (const group of groups) {
    // Conditional groups (e.g. "Enter Name", shown only when "Add Name: Yes" is picked)
    // are skipped entirely — not required, and any submission for them is ignored —
    // unless their trigger value was actually selected.
    if (group.conditional_parent_value_id && !selectedValueIds.has(group.conditional_parent_value_id)) {
      continue;
    }

    const selection = selectionByGroupId.get(group.id);
    const enabledValues: any[] = (group.customization_values ?? []).filter((v: any) => v.enabled);

    if (!selection) {
      if (group.required) throw HttpError.badRequest(`Please choose ${group.label.toLowerCase()}`);
      continue;
    }

    if (group.type === "text" || group.type === "number") {
      const textValue = (selection.textValue ?? "").trim();
      if (!textValue) {
        if (group.required) throw HttpError.badRequest(`Please fill in ${group.label.toLowerCase()}`);
        continue;
      }
      if (group.max_length && textValue.length > group.max_length) {
        throw HttpError.badRequest(`${group.label} exceeds the ${group.max_length} character limit`);
      }
      if (group.type === "number" && Number.isNaN(Number(textValue))) {
        throw HttpError.badRequest(`${group.label} must be a number`);
      }
      snapshot.push({
        customizationId: group.id,
        name: group.name,
        label: group.label,
        type: group.type,
        textValue,
        priceAdjustment: 0,
      });
      continue;
    }

    // choice / color / checkbox — a value from this product's own enabled values.
    const value = enabledValues.find((v) => v.id === selection.valueId);
    if (!value) {
      throw HttpError.badRequest(`That option isn't available for "${group.label}" on this product`);
    }
    const priceAdjustment = Number(value.price_adjustment ?? 0);
    priceAdjustmentTotal += priceAdjustment;
    snapshot.push({
      customizationId: group.id,
      name: group.name,
      label: group.label,
      type: group.type,
      valueId: value.id,
      valueLabel: value.label,
      value: value.value,
      priceAdjustment,
    });
  }

  return { snapshot, priceAdjustmentTotal: Math.round(priceAdjustmentTotal * 100) / 100 };
}

export async function validateAndPriceCart(
  items: CartItemInput[],
  opts: { shippingMethod?: string; couponCode?: string; giftWrap?: boolean; customerId?: string; shippingState?: string } = {}
) {
  if (!items.length) throw HttpError.badRequest("Cart is empty");

  const lines: ValidatedLine[] = [];

  for (const item of items) {
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("id", item.productId)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !product) {
      throw HttpError.badRequest("One of the items in your cart is no longer available");
    }
    if (item.quantity < 1) throw HttpError.badRequest("Invalid quantity");
    const stockIsTracked = product.track_inventory !== false;
    const stockExempt = product.allow_backorders || product.continue_selling_when_out_of_stock;
    if (stockIsTracked && !stockExempt && product.stock < item.quantity) {
      throw HttpError.badRequest(`"${product.name}" only has ${product.stock} left in stock`);
    }

    const baseColors: { hex: string; name: string }[] = (product.product_colors ?? [])
      .map((pc: any) => pc.colors)
      .filter(Boolean);

    const rule = product.customization_rules;
    const allowedColorHexes: string[] = (rule?.customization_allowed_colors ?? [])
      .map((r: any) => r.colors?.hex)
      .filter(Boolean);

    let selectedColorHex = item.selectedColor;
    let selectedColorName: string | undefined;

    if (item.customText) {
      if (!rule?.is_customizable || !rule?.allow_text) {
        throw HttpError.badRequest(`"${product.name}" does not support text customization`);
      }
      if (rule.max_text_length && item.customText.length > rule.max_text_length) {
        throw HttpError.badRequest(
          `Custom text for "${product.name}" exceeds the ${rule.max_text_length} character limit`
        );
      }
      if (rule.allow_color_choice === false) {
        // Admin has fixed the color for customized orders of this product — the client's
        // choice (if any) is overridden rather than rejected.
        selectedColorHex = allowedColorHexes[0] ?? baseColors[0]?.hex;
      } else if (allowedColorHexes.length > 0 && selectedColorHex && !allowedColorHexes.includes(selectedColorHex)) {
        throw HttpError.badRequest(`That color isn't available for customizing "${product.name}"`);
      }
    }

    if (selectedColorHex) {
      const match = baseColors.find((c) => c.hex === selectedColorHex);
      if (!match && baseColors.length > 0) {
        throw HttpError.badRequest(`That color isn't available for "${product.name}"`);
      }
      selectedColorName = match?.name;
    }

    const basePrice = getEffectivePrice(product);
    const { snapshot: customizations, priceAdjustmentTotal } = resolveCustomizations(
      product,
      item.customizations ?? []
    );
    const unitPrice = Math.round((basePrice + priceAdjustmentTotal) * 100) / 100;
    const primaryImage = (product.product_images ?? [])
      .slice()
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.url;

    lines.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      image: primaryImage,
      basePrice,
      unitPrice,
      quantity: item.quantity,
      selectedColorHex,
      selectedColorName,
      customText: item.customText,
      customizations,
      lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
      taxCategoryId: product.tax_category_id,
    });
  }

  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;

  let discount = 0;
  let coupon: any = null;
  if (opts.couponCode) {
    coupon = await validateCoupon(opts.couponCode, subtotal, opts.customerId);
    discount =
      coupon.type === "percent"
        ? Math.round(((subtotal * Number(coupon.value)) / 100) * 100) / 100
        : Math.min(Number(coupon.value), subtotal);
  }

  const netSubtotal = subtotal - discount;
  const [shippingQuote, giftWrapFee, gstEnabled, pricesIncludeGst, sellerState, defaultTaxCategoryId] = await Promise.all([
    getShippingQuote(opts.shippingState, netSubtotal, opts.shippingMethod === "express" ? "express" : "standard"),
    getSetting<number>("shipping.gift_wrap_fee"),
    getSetting<boolean>("tax.gst_enabled"),
    getSetting<boolean>("tax.prices_include_gst"),
    getSetting<string>("business.gst_state"),
    getSetting<string>("tax.default_tax_category_id"),
  ]);

  const shippingCost = shippingQuote.fee;
  const giftWrapCost = opts.giftWrap ? giftWrapFee : 0;

  // GST is off by default (tax.gst_enabled=false) — in that state this block is fully
  // inert and pricing is byte-identical to the pre-settings implementation.
  let taxAmount = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;
  let total = Math.round((netSubtotal + shippingCost + giftWrapCost) * 100) / 100;

  if (gstEnabled && opts.shippingState && sellerState) {
    const rateByCategoryId = await getTaxRatesByCategory();

    // Compute GST per line (rates can differ by product) rather than on the pooled
    // subtotal, then sum — correct even when the cart mixes tax categories.
    let totalTax = 0;
    for (const line of lines) {
      const rate = rateByCategoryId.get(line.taxCategoryId ?? "") ?? rateByCategoryId.get(defaultTaxCategoryId) ?? 0;
      const gst = computeGst({
        amount: line.lineTotal,
        ratePercent: rate,
        sellerState,
        buyerState: opts.shippingState,
        pricesIncludeGst,
      });
      totalTax += gst.totalTax;
      cgstAmount += gst.cgst;
      sgstAmount += gst.sgst;
      igstAmount += gst.igst;
    }
    taxAmount = Math.round(totalTax * 100) / 100;
    cgstAmount = Math.round(cgstAmount * 100) / 100;
    sgstAmount = Math.round(sgstAmount * 100) / 100;
    igstAmount = Math.round(igstAmount * 100) / 100;

    // Inclusive pricing: tax is already inside netSubtotal, so the total doesn't change —
    // only the breakdown is stored, for invoice display. Exclusive pricing adds it on top.
    if (!pricesIncludeGst) {
      total = Math.round((netSubtotal + shippingCost + giftWrapCost + taxAmount) * 100) / 100;
    }
  }

  return {
    lines,
    subtotal,
    discount,
    coupon,
    shippingCost,
    giftWrapCost,
    total,
    taxAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    shippingEstimate: shippingQuote.estimateDays,
  };
}

let taxRateCache: Map<string, number> | null = null;
async function getTaxRatesByCategory(): Promise<Map<string, number>> {
  if (taxRateCache) return taxRateCache;
  const { data } = await supabaseAdmin.from("tax_categories").select("id, rate");
  taxRateCache = new Map((data ?? []).map((r: any) => [r.id, Number(r.rate)]));
  return taxRateCache;
}

export async function validateCoupon(code: string, subtotal: number, customerId?: string) {
  const { data: coupon } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .eq("code", code.toUpperCase())
    .eq("is_active", true)
    .maybeSingle();

  if (!coupon) throw HttpError.badRequest("Invalid coupon code");

  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) throw HttpError.badRequest("This coupon isn't active yet");
  if (coupon.expires_at && new Date(coupon.expires_at) < now) throw HttpError.badRequest("This coupon has expired");
  if (subtotal < Number(coupon.min_subtotal)) {
    throw HttpError.badRequest(`Add more to your cart to use this coupon (minimum order value applies)`);
  }
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
    throw HttpError.badRequest("This coupon has reached its usage limit");
  }
  if (customerId && coupon.max_uses_per_customer != null) {
    const { count } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", coupon.id)
      .eq("customer_id", customerId);
    if ((count ?? 0) >= coupon.max_uses_per_customer) {
      throw HttpError.badRequest("You've already used this coupon");
    }
  }
  return coupon;
}

async function generateOrderNumber(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("next_order_number");
  if (error || !data) {
    // Sequence generation is best-effort infrastructure — a random fallback keeps
    // checkout working even if the counter function isn't available yet.
    return `ORD-${new Date().getFullYear()}-${randomInt(1000, 9999)}`;
  }
  return data as unknown as string;
}

export interface ShippingAddressInput {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  addressLine1: string;
  addressLine2?: string;
  landmark?: string;
  city: string;
  district?: string;
  state: string;
  pincode: string;
}

export interface PlaceOrderInput {
  items: CartItemInput[];
  shippingAddress: ShippingAddressInput;
  shippingMethod: string;
  paymentMethod: "cod" | "razorpay";
  couponCode?: string;
  giftWrap?: boolean;
  giftMessage?: string;
  customerId?: string;
}

export async function placeOrder(input: PlaceOrderInput) {
  const [razorpayEnabled, codEnabled, codMin, codMax, orderMin, orderMax] = await Promise.all([
    getSetting<boolean>("payment.razorpay_enabled"),
    getSetting<boolean>("payment.cod_enabled"),
    getSetting<number>("payment.cod_min_amount"),
    getSetting<number>("payment.cod_max_amount"),
    getSetting<number>("order.min_amount"),
    getSetting<number>("order.max_amount"),
  ]);
  if (input.paymentMethod === "razorpay" && !razorpayEnabled) throw HttpError.badRequest("Online payment is currently unavailable");
  if (input.paymentMethod === "cod" && !codEnabled) throw HttpError.badRequest("Cash on Delivery is currently unavailable");

  const priced = await validateAndPriceCart(input.items, {
    shippingMethod: input.shippingMethod,
    couponCode: input.couponCode,
    giftWrap: input.giftWrap,
    customerId: input.customerId,
    shippingState: input.shippingAddress.state,
  });

  if (orderMin > 0 && priced.total < orderMin) throw HttpError.badRequest(`Minimum order amount is ${formatPrice(orderMin)}`);
  if (orderMax > 0 && priced.total > orderMax) throw HttpError.badRequest(`Maximum order amount is ${formatPrice(orderMax)}`);

  if (input.paymentMethod === "cod") {
    if (codMin > 0 && priced.total < codMin) throw HttpError.badRequest(`Cash on Delivery requires a minimum order of ${formatPrice(codMin)}`);
    if (codMax > 0 && priced.total > codMax) throw HttpError.badRequest(`Cash on Delivery is unavailable for orders above ${formatPrice(codMax)}`);
  }

  const orderNumber = await generateOrderNumber();
  const isCod = input.paymentMethod === "cod";

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      order_number: orderNumber,
      customer_id: input.customerId ?? null,
      guest_email: input.shippingAddress.email ?? null,
      guest_phone: input.shippingAddress.phone ?? null,
      subtotal: priced.subtotal,
      discount_amount: priced.discount,
      coupon_id: priced.coupon?.id ?? null,
      shipping_cost: priced.shippingCost,
      gift_wrap_cost: priced.giftWrapCost,
      total: priced.total,
      tax_amount: priced.taxAmount,
      cgst_amount: priced.cgstAmount,
      sgst_amount: priced.sgstAmount,
      igst_amount: priced.igstAmount,
      shipping_address: input.shippingAddress,
      shipping_method: input.shippingMethod,
      payment_method: input.paymentMethod,
      payment_status: "pending",
      status: isCod ? "confirmed" : "pending_payment",
      gift_wrap: Boolean(input.giftWrap),
      gift_message: input.giftMessage,
      placed_at: isCod ? new Date().toISOString() : null,
    })
    .select("*")
    .single();

  if (orderError || !order) throw HttpError.internal(orderError?.message ?? "Failed to create order");

  const { error: itemsError } = await supabaseAdmin.from("order_items").insert(
    priced.lines.map((l) => ({
      order_id: order.id,
      product_id: l.productId,
      product_name_snapshot: l.name,
      product_sku_snapshot: l.sku,
      product_image_snapshot: l.image,
      unit_price_snapshot: l.unitPrice,
      selected_color_hex: l.selectedColorHex,
      selected_color_name: l.selectedColorName,
      custom_text: l.customText,
      customizations: l.customizations,
      quantity: l.quantity,
      line_total: l.lineTotal,
    }))
  );
  if (itemsError) throw HttpError.internal(itemsError.message);

  await supabaseAdmin.from("order_status_history").insert({
    order_id: order.id,
    status: order.status,
    note: isCod ? "Order placed (Cash on Delivery)" : "Order created, awaiting payment",
  });

  if (isCod) {
    for (const line of priced.lines) {
      await supabaseAdmin.rpc("decrement_product_stock", { p_product_id: line.productId, p_qty: line.quantity });
    }
    if (priced.coupon) await redeemCoupon(priced.coupon.id, order.id, input.customerId, priced.discount);
    if (input.customerId) await clearServerCart(input.customerId);

    notifyOrderPlaced({
      orderId: order.id,
      orderNumber: order.order_number,
      paymentMethod: "cod",
      subtotal: priced.subtotal,
      discountAmount: priced.discount,
      shippingCost: priced.shippingCost,
      giftWrapCost: priced.giftWrapCost,
      total: priced.total,
      shippingAddress: input.shippingAddress,
      items: priced.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        selectedColorName: l.selectedColorName,
        customText: l.customText,
      })),
    });

    return { order, razorpayOrder: null };
  }

  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(priced.total * 100),
    currency: "INR",
    receipt: orderNumber,
    notes: { orderId: order.id },
  });

  await supabaseAdmin.from("orders").update({ razorpay_order_id: razorpayOrder.id }).eq("id", order.id);

  return { order: { ...order, razorpay_order_id: razorpayOrder.id }, razorpayOrder };
}

async function redeemCoupon(couponId: string, orderId: string, customerId: string | undefined, amount: number) {
  await supabaseAdmin.from("coupon_redemptions").insert({
    coupon_id: couponId,
    order_id: orderId,
    customer_id: customerId ?? null,
    amount_discounted: amount,
  });
  await supabaseAdmin.rpc("increment_coupon_uses", { p_coupon_id: couponId });
}

async function clearServerCart(customerId: string) {
  await supabaseAdmin.from("cart_items").delete().eq("customer_id", customerId);
}

interface NotifyOrderPlacedArgs {
  orderId: string;
  orderNumber: string;
  paymentMethod: string;
  subtotal: number;
  discountAmount: number;
  shippingCost: number;
  giftWrapCost: number;
  total: number;
  shippingAddress: any;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number; selectedColorName?: string | null; customText?: string | null }[];
}

/** Fire-and-forget — invoice generation and email failures are logged internally and
 * never block checkout (the order itself is already committed by the time this runs). */
function notifyOrderPlaced(args: NotifyOrderPlacedArgs) {
  const payload = {
    orderNumber: args.orderNumber,
    customerName: `${args.shippingAddress.firstName} ${args.shippingAddress.lastName}`.trim(),
    customerEmail: args.shippingAddress.email as string | undefined,
    paymentMethod: args.paymentMethod,
    subtotal: args.subtotal,
    discountAmount: args.discountAmount,
    shippingCost: args.shippingCost,
    giftWrapCost: args.giftWrapCost,
    total: args.total,
    shippingAddress: args.shippingAddress,
    items: args.items,
  };

  sendAdminOrderNotification(payload).catch((err) =>
    logger.error({ err, orderNumber: args.orderNumber }, "Admin order notification failed")
  );

  (async () => {
    const invoice = await createInvoiceForOrder(args.orderId);
    if (!payload.customerEmail) return;

    let attachments: { filename: string; content: Buffer }[] | undefined;
    try {
      const pdf = await renderInvoicePdf(invoice.invoice_number, invoice.snapshot, "confirmed", "paid");
      attachments = [{ filename: `${invoice.invoice_number}.pdf`, content: pdf }];
    } catch (err) {
      logger.error({ err, orderId: args.orderId }, "Invoice PDF generation failed — sending order_placed without attachment");
    }

    await sendTemplatedEmail({
      type: "order_placed",
      to: payload.customerEmail,
      variables: {
        customer_name: payload.customerName,
        order_number: payload.orderNumber,
        order_date: new Date().toLocaleDateString("en-IN"),
        order_total: formatPrice(payload.total),
        store_name: "Suthrayaa",
        invoice_number: invoice.invoice_number,
      },
      rawVariables: {
        items_table: renderOrderDetailsHtml(payload),
        address_block: renderAddressHtml(payload.shippingAddress),
      },
      relatedOrderId: args.orderId,
      attachments,
    });
  })().catch((err) => logger.error({ err, orderNumber: args.orderNumber }, "Order placed notification failed"));
}

export async function verifyRazorpayPayment(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(input.razorpaySignature);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!valid) throw HttpError.badRequest("Payment verification failed");

  return markOrderPaidByRazorpayOrderId(input.razorpayOrderId, input.razorpayPaymentId);
}

/** Idempotent — safe to call from both the client verify-payment call and the Razorpay webhook. */
export async function markOrderPaidByRazorpayOrderId(razorpayOrderId: string, razorpayPaymentId?: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, status, payment_status, payment_method, customer_id, coupon_id, discount_amount, subtotal, shipping_cost, gift_wrap_cost, total, shipping_address"
    )
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();

  if (!order) return null;
  if (order.payment_status === "paid") return order;

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("product_id, quantity, product_name_snapshot, unit_price_snapshot, line_total, selected_color_name, custom_text")
    .eq("order_id", order.id);

  for (const item of items ?? []) {
    if (item.product_id) {
      await supabaseAdmin.rpc("decrement_product_stock", { p_product_id: item.product_id, p_qty: item.quantity });
    }
  }

  await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "paid",
      status: "confirmed",
      razorpay_payment_id: razorpayPaymentId,
      placed_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  await supabaseAdmin.from("order_status_history").insert({
    order_id: order.id,
    status: "confirmed",
    note: "Payment verified via Razorpay",
  });

  if (order.coupon_id) {
    await redeemCoupon(order.coupon_id, order.id, order.customer_id ?? undefined, Number(order.discount_amount));
  }
  if (order.customer_id) await clearServerCart(order.customer_id);

  notifyOrderPlaced({
    orderId: order.id,
    orderNumber: order.order_number,
    paymentMethod: order.payment_method,
    subtotal: Number(order.subtotal),
    discountAmount: Number(order.discount_amount),
    shippingCost: Number(order.shipping_cost),
    giftWrapCost: Number(order.gift_wrap_cost),
    total: Number(order.total),
    shippingAddress: order.shipping_address,
    items: (items ?? []).map((i) => ({
      name: i.product_name_snapshot,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price_snapshot),
      lineTotal: Number(i.line_total),
      selectedColorName: i.selected_color_name,
      customText: i.custom_text,
    })),
  });

  const email = order.shipping_address?.email as string | undefined;
  if (email) {
    sendTemplatedEmail({
      type: "payment_successful",
      to: email,
      variables: {
        customer_name: `${order.shipping_address.firstName} ${order.shipping_address.lastName}`.trim(),
        order_number: order.order_number,
        order_total: formatPrice(Number(order.total)),
        store_name: "Suthrayaa",
      },
      relatedOrderId: order.id,
    }).catch((err) => logger.error({ err, orderId: order.id }, "payment_successful email failed"));
  }

  return order;
}

export async function markOrderFailedByRazorpayOrderId(razorpayOrderId: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, order_number, total, payment_status, shipping_address, guest_email")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();
  if (!order || order.payment_status === "paid") return;

  await supabaseAdmin.from("orders").update({ payment_status: "failed" }).eq("id", order.id);
  await supabaseAdmin.from("order_status_history").insert({
    order_id: order.id,
    status: "pending_payment",
    note: "Payment failed",
  });

  const addr = (order.shipping_address ?? {}) as Record<string, string>;
  const customerName = addr.firstName ? `${addr.firstName} ${addr.lastName ?? ""}`.trim() : "there";
  const customerEmail = order.guest_email ?? addr.email;
  const orderTotal = formatPrice(Number(order.total));

  if (customerEmail) {
    sendTemplatedEmail({
      type: "payment_failed",
      to: customerEmail,
      variables: { customer_name: customerName, order_number: order.order_number, order_total: orderTotal, store_name: "Suthrayaa" },
      relatedOrderId: order.id,
    }).catch((err) => logger.error({ err, orderId: order.id }, "payment_failed email failed"));
  }
  if (env.ADMIN_NOTIFICATION_EMAIL) {
    sendTemplatedEmail({
      type: "admin_payment_failed",
      to: env.ADMIN_NOTIFICATION_EMAIL,
      variables: {
        customer_name: customerName,
        customer_email: customerEmail ?? "no email on file",
        order_number: order.order_number,
        order_total: orderTotal,
        store_name: "Suthrayaa",
        ...storeLinkVariables(),
      },
      relatedOrderId: order.id,
    }).catch((err) => logger.error({ err, orderId: order.id }, "admin_payment_failed email failed"));
  }
}
