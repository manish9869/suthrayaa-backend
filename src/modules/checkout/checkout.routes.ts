import { Router } from "express";
import { z } from "zod";
import { optionalAuthenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { sensitiveLimiter } from "../../middleware/rateLimiter.js";
import { HttpError } from "../../lib/httpError.js";
import { env } from "../../config/env.js";
import { validateAndPriceCart, placeOrder, verifyRazorpayPayment } from "./checkout.service.js";

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
});

checkoutRouter.post(
  "/validate-cart",
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
      });
      res.json(priced);
    } catch (err) {
      next(err);
    }
  }
);

const addressSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(6),
  email: z.string().email().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(4),
});

const placeOrderSchema = z.object({
  items: z.array(cartItemSchema).min(1),
  shippingAddress: addressSchema,
  shippingMethod: z.enum(["standard", "express"]),
  paymentMethod: z.enum(["cod", "razorpay"]),
  couponCode: z.string().optional(),
  giftWrap: z.boolean().optional(),
  giftMessage: z.string().max(300).optional(),
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
