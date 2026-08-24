import { Router } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { toColorDTO } from "./serializers.js";

export const colorsRouter = Router();

colorsRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("colors")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toColorDTO));
  } catch (err) {
    next(err);
  }
});
