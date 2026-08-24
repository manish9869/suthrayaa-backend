import { Router } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { toCategoryDTO } from "./serializers.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", async (_req, res, next) => {
  try {
    const { data: categories, error } = await supabaseAdmin
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw HttpError.internal(error.message);

    const { data: counts } = await supabaseAdmin.from("v_category_product_counts").select("*");
    const countMap = new Map((counts ?? []).map((c: any) => [c.category_id, c.product_count]));

    res.json((categories ?? []).map((c) => toCategoryDTO(c, countMap.get(c.id) ?? 0)));
  } catch (err) {
    next(err);
  }
});

categoriesRouter.get("/:slug", async (req, res, next) => {
  try {
    const { data: category, error } = await supabaseAdmin
      .from("categories")
      .select("*")
      .eq("slug", req.params.slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!category) throw HttpError.notFound("Category not found");

    const { count } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", category.id)
      .eq("is_active", true);

    res.json(toCategoryDTO(category, count ?? 0));
  } catch (err) {
    next(err);
  }
});
