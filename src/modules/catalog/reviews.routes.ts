import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../../config/supabase.js";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { HttpError } from "../../lib/httpError.js";
import { toReviewDTO } from "./serializers.js";

export const reviewsRouter = Router();

const createReviewSchema = z.object({
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(120).optional(),
  content: z.string().min(1).max(2000),
  images: z.array(z.string().url()).max(5).optional(),
});

reviewsRouter.post("/", authenticate, validate(createReviewSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof createReviewSchema>;

    const { data: paidOrders } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("customer_id", req.user!.id)
      .eq("payment_status", "paid");

    let isVerifiedPurchase = false;
    if (paidOrders && paidOrders.length > 0) {
      const { data: item } = await supabaseAdmin
        .from("order_items")
        .select("id")
        .eq("product_id", body.productId)
        .in(
          "order_id",
          paidOrders.map((o) => o.id)
        )
        .limit(1)
        .maybeSingle();
      isVerifiedPurchase = Boolean(item);
    }

    const { data: profile } = await supabaseAdmin
      .from("customer_profiles")
      .select("first_name, last_name, email")
      .eq("id", req.user!.id)
      .maybeSingle();

    const customerName = profile?.first_name
      ? `${profile.first_name} ${profile.last_name ?? ""}`.trim()
      : profile?.email ?? "Customer";

    const { data, error } = await supabaseAdmin
      .from("reviews")
      .insert({
        product_id: body.productId,
        customer_id: req.user!.id,
        customer_name: customerName,
        rating: body.rating,
        title: body.title,
        content: body.content,
        images: body.images ?? [],
        is_verified_purchase: isVerifiedPurchase,
        is_published: false,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);

    res.status(201).json({ ...toReviewDTO(data), pendingModeration: true });
  } catch (err) {
    next(err);
  }
});
