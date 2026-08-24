import { Router } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { toTestimonialDTO } from "./serializers.js";

export const testimonialsRouter = Router();

testimonialsRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("testimonials")
      .select("*")
      .eq("is_published", true)
      .order("sort_order", { ascending: true });
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toTestimonialDTO));
  } catch (err) {
    next(err);
  }
});
