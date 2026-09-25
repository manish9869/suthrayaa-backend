import { Router } from "express";
import { z } from "zod";
import { optionalAuthenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { moderateLimiter, sensitiveLimiter } from "../../middleware/rateLimiter.js";
import { HttpError } from "../../lib/httpError.js";
import { env } from "../../config/env.js";
import { validateAndPriceCart, placeOrder, verifyRazorpayPayment, checkCartLines, getCheckoutOptions } from "./checkout.service.js";
import { isValidIndianMobile, isValidIndianPincode, isValidIndianState, normalizeIndianMobile } from "../settings/india.data.js";

export const checkoutRouter = Router();

const customizationSelectionSchema = z.object({
  customizationId: z.string().uuid(),
  valueId: z.string().uuid().optional(),
  textValue: z.string().max(1000).optional(),
});

const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  selectedColor: z.string().optional(),
  customText: z.string().max(200).optional(),
  customizations: z.array(customizationSelectionSchema).optional(),
});

const validateCartSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  shippingMethod: z.enum(["standard", "express"]).optional(),
  couponCode: z.string().optional(),
  giftWrap: z.boolean().optional(),
  shippingState: z.string().optional(),
});

checkoutRouter.post(
  "/validate-cart",
  moderateLimiter,
  optionalAuthenticate,
  validate(validateCartSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof validateCartSchema>;
      const priced = await validateAndPriceCart(body.items, {
        shippingMethod: body.shippingMethod,
        couponCode: body.couponCode,
        giftWrap: body.giftWrap,
        customerId: req.user?.id,
        shippingState: body.shippingState,
      });
      res.json(priced);
    } catch (err) {
      next(err);
    }
  }
);

/** Payment and order rules the checkout shows before the customer commits to anything. */
checkoutRouter.get("/options", async (_req, res, next) => {
  try {
    res.json(await getCheckoutOptions());
  } catch (err) {
    next(err);
  }
});

/** Checks every cart line independently and returns all issues (never throws for a bad line). */
checkoutRouter.post("/check-cart", moderateLimiter, optionalAuthenticate, validate(z.object({ items: z.array(cartItemSchema).max(100) })), async (req, res, next) => {
  try {
    res.json({ issues: await checkCartLines((req.body as { items: z.infer<typeof cartItemSchema>[] }).items) });
  } catch (err) {
    next(err);
  }
});

const addressSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z
    .string()
    .refine(isValidIndianMobile, "Enter a valid 10-digit Indian mobile number")
    .transform(normalizeIndianMobile),
  email: z.string().email().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string().min(1),
  district: z.string().optional(),
  state: z.string().refine(isValidIndianState, "Select a valid Indian state or union territory"),
  pincode: z.string().refine(isValidIndianPincode, "Enter a valid 6-digit PIN code"),
});

const placeOrderSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  shippingAddress: addressSchema,
  billingAddress: addressSchema.omit({ email: true }).optional(),
  shippingMethod: z.enum(["standard", "express"]),
  paymentMethod: z.enum(["cod", "razorpay"]),
  couponCode: z.string().optional(),
  giftWrap: z.boolean().optional(),
  giftMessage: z.string().max(300).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

checkoutRouter.post(
  "/place-order",
  sensitiveLimiter,
  optionalAuthenticate,
  validate(placeOrderSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof placeOrderSchema>;
      const result = await placeOrder({ ...body, customerId: req.user?.id });

      res.status(201).json({
        order: {
          id: result.order.id,
          orderNumber: result.order.order_number,
          status: result.order.status,
          paymentStatus: result.order.payment_status,
          total: result.order.total,
        },
        razorpay: result.razorpayOrder
          ? {
              orderId: result.razorpayOrder.id,
              amount: result.razorpayOrder.amount,
              currency: result.razorpayOrder.currency,
              keyId: env.RAZORPAY_KEY_ID,
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  }
);

const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

checkoutRouter.post(
  "/verify-payment",
  sensitiveLimiter,
  validate(verifyPaymentSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof verifyPaymentSchema>;
      const order = await verifyRazorpayPayment(body);
      if (!order) throw HttpError.notFound("Order not found for this payment");
      res.json({ ok: true, orderId: order.id });
    } catch (err) {
      next(err);
    }
  }
);
