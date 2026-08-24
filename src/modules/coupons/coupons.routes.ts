import { Router } from "express";
import { z } from "zod";
import { optionalAuthenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { validateCoupon } from "../checkout/checkout.service.js";

// Coupons are never listed to the client (see coupons table RLS) — only checked one at a time.
export const couponsRouter = Router();

const checkSchema = z.object({ code: z.string().min(1), subtotal: z.number().min(0) });

couponsRouter.post("/validate", optionalAuthenticate, validate(checkSchema), async (req, res, next) => {
  try {
    const { code, subtotal } = req.body as z.infer<typeof checkSchema>;
    const coupon = await validateCoupon(code, subtotal, req.user?.id);
    const discount =
      coupon.type === "percent"
        ? Math.round(((subtotal * Number(coupon.value)) / 100) * 100) / 100
        : Math.min(Number(coupon.value), subtotal);
    res.json({ valid: true, code: coupon.code, type: coupon.type, value: Number(coupon.value), discount });
  } catch (err) {
    next(err);
  }
});
