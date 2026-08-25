import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

export const adminCouponsRouter = Router();
adminCouponsRouter.use(authenticate, requireAdmin);

adminCouponsRouter.get("/", requirePermission("coupons.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("coupons").select("*").order("created_at", { ascending: false });
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

const couponSchema = z.object({
  code: z.string().min(3).max(30),
  type: z.enum(["percent", "flat"]),
  value: z.number().positive(),
  minSubtotal: z.number().min(0).optional(),
  maxUses: z.number().int().positive().optional().nullable(),
  maxUsesPerCustomer: z.number().int().positive().optional().nullable(),
  startsAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

adminCouponsRouter.post("/", requirePermission("coupons.create"), validate(couponSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof couponSchema>;
    const { data, error } = await supabaseAdmin
      .from("coupons")
      .insert({
        code: b.code.toUpperCase(),
        type: b.type,
        value: b.value,
        min_subtotal: b.minSubtotal ?? 0,
        max_uses: b.maxUses,
        max_uses_per_customer: b.maxUsesPerCustomer,
        starts_at: b.startsAt,
        expires_at: b.expiresAt,
        is_active: b.isActive ?? true,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

adminCouponsRouter.patch("/:id", requirePermission("coupons.update"), validate(couponSchema.partial()), async (req, res, next) => {
  try {
    const b = req.body as Partial<z.infer<typeof couponSchema>>;
    const { data, error } = await supabaseAdmin
      .from("coupons")
      .update({
        code: b.code?.toUpperCase(),
        type: b.type,
        value: b.value,
        min_subtotal: b.minSubtotal,
        max_uses: b.maxUses,
        max_uses_per_customer: b.maxUsesPerCustomer,
        starts_at: b.startsAt,
        expires_at: b.expiresAt,
        is_active: b.isActive,
      })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Coupon not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminCouponsRouter.delete("/:id", requirePermission("coupons.delete"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("coupons").update({ is_active: false }).eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
