import { randomInt } from "node:crypto";
import crypto from "node:crypto";
import { supabaseAdmin } from "../../config/supabase.js";
import { razorpay } from "../../config/razorpay.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/httpError.js";
import { PRODUCT_SELECT } from "../catalog/serializers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CartItemInput {
  productId: string;
  quantity: number;
  selectedColor?: string;
  customText?: string;
}

interface ValidatedLine {
  productId: string;
  name: string;
  image?: string;
  unitPrice: number;
  quantity: number;
  selectedColorHex?: string;
  selectedColorName?: string;
  customText?: string;
  lineTotal: number;
}

const SHIPPING_RATES: Record<string, number> = { standard: 60, express: 150 };
const FREE_SHIPPING_THRESHOLD = 999;
const GIFT_WRAP_COST = 49;

export async function validateAndPriceCart(
  items: CartItemInput[],
  opts: { shippingMethod?: string; couponCode?: string; giftWrap?: boolean; customerId?: string } = {}
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
    if (product.stock < item.quantity) {
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

    const unitPrice = Number(product.price);
    const primaryImage = (product.product_images ?? [])
      .slice()
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.url;

    lines.push({
      productId: product.id,
      name: product.name,
      image: primaryImage,
      unitPrice,
      quantity: item.quantity,
      selectedColorHex,
      selectedColorName,
      customText: item.customText,
      lineTotal: Math.round(unitPrice * item.quantity * 100) / 100,
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

  const shippingCost =
    subtotal - discount >= FREE_SHIPPING_THRESHOLD
      ? 0
      : SHIPPING_RATES[opts.shippingMethod ?? "standard"] ?? SHIPPING_RATES.standard;
  const giftWrapCost = opts.giftWrap ? GIFT_WRAP_COST : 0;
  const total = Math.round((subtotal - discount + shippingCost + giftWrapCost) * 100) / 100;

  return { lines, subtotal, discount, coupon, shippingCost, giftWrapCost, total };
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

function generateOrderNumber() {
  const year = new Date().getFullYear();
  return `SUT-${year}-${randomInt(100000, 999999)}`;
}

export interface ShippingAddressInput {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
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
  const priced = await validateAndPriceCart(input.items, {
    shippingMethod: input.shippingMethod,
    couponCode: input.couponCode,
    giftWrap: input.giftWrap,
    customerId: input.customerId,
  });

  const orderNumber = generateOrderNumber();
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
      product_image_snapshot: l.image,
      unit_price_snapshot: l.unitPrice,
      selected_color_hex: l.selectedColorHex,
      selected_color_name: l.selectedColorName,
      custom_text: l.customText,
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
    .select("id, status, payment_status, customer_id, coupon_id, discount_amount")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();

  if (!order) return null;
  if (order.payment_status === "paid") return order;

  const { data: items } = await supabaseAdmin
    .from("order_items")
    .select("product_id, quantity")
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

  return order;
}

export async function markOrderFailedByRazorpayOrderId(razorpayOrderId: string) {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, payment_status")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();
  if (!order || order.payment_status === "paid") return;

  await supabaseAdmin.from("orders").update({ payment_status: "failed" }).eq("id", order.id);
  await supabaseAdmin.from("order_status_history").insert({
    order_id: order.id,
    status: "pending_payment",
    note: "Payment failed",
  });
}
