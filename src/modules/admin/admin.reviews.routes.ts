import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

export const adminReviewsRouter = Router();
adminReviewsRouter.use(authenticate, requireAdmin);

adminReviewsRouter.get("/", requirePermission("reviews.view"), async (req, res, next) => {
  try {
    const { status = "pending" } = req.query as Record<string, string>;
    let query = supabaseAdmin.from("reviews").select("*, products(name, slug)").order("created_at", { ascending: false });
    if (status === "pending") query = query.eq("is_published", false);
    if (status === "published") query = query.eq("is_published", true);
    const { data, error } = await query;
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

const moderateSchema = z.object({ isPublished: z.boolean() });

adminReviewsRouter.patch("/:id", requirePermission("reviews.update"), validate(moderateSchema), async (req, res, next) => {
  try {
    const { isPublished } = req.body as z.infer<typeof moderateSchema>;
    const { data, error } = await supabaseAdmin
      .from("reviews")
      .update({ is_published: isPublished })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Review not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminReviewsRouter.delete("/:id", requirePermission("reviews.delete"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("reviews").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
