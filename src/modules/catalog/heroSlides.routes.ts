import { Router } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { toHeroSlideDTO } from "./serializers.js";

export const heroSlidesRouter = Router();

heroSlidesRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("hero_slides")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toHeroSlideDTO));
  } catch (err) {
    next(err);
  }
});
