import { Router } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { sanitizeSearchTerm } from "../../lib/sanitize.js";
import { PRODUCT_SELECT, toProductDTO, toReviewDTO } from "./serializers.js";

export const productsRouter = Router();

const SORTS: Record<string, { column: string; ascending: boolean }> = {
  "price-asc": { column: "price", ascending: true },
  "price-desc": { column: "price", ascending: false },
  newest: { column: "created_at", ascending: false },
  rating: { column: "rating", ascending: false },
};

productsRouter.get("/", async (req, res, next) => {
  try {
    const {
      category,
      search,
      featured,
      bestseller,
      newArrival,
      page = "1",
      limit = "24",
      sort,
    } = req.query as Record<string, string>;

    let query = supabaseAdmin
      .from("products")
      .select(PRODUCT_SELECT, { count: "exact" })
      .eq("is_active", true);

    if (category) {
      const { data: cat } = await supabaseAdmin
        .from("categories")
        .select("id")
        .eq("slug", category)
        .maybeSingle();
      if (!cat) return res.json({ items: [], total: 0, page: 1, limit: Number(limit) || 24 });
      query = query.eq("category_id", cat.id);
    }

    if (search) {
      const term = sanitizeSearchTerm(search);
      if (term) {
        query = query.or(
          `name.ilike.%${term}%,description.ilike.%${term}%,short_description.ilike.%${term}%`
        );
      }
    }

    if (featured === "true") query = query.eq("featured", true);
    if (bestseller === "true") query = query.eq("bestseller", true);
    if (newArrival === "true") query = query.eq("new_arrival", true);

    const sortSpec = SORTS[sort ?? ""] ?? { column: "created_at", ascending: false };
    query = query.order(sortSpec.column, { ascending: sortSpec.ascending });

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 24));
    const from = (pageNum - 1) * limitNum;
    query = query.range(from, from + limitNum - 1);

    const { data, error, count } = await query;
    if (error) throw HttpError.internal(error.message);

    res.json({
      items: (data ?? []).map((p) => toProductDTO(p)),
      total: count ?? 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/:slug", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("slug", req.params.slug)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Product not found");
    res.json(toProductDTO(data));
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/:slug/reviews", async (req, res, next) => {
  try {
    const { data: product } = await supabaseAdmin
      .from("products")
      .select("id")
      .eq("slug", req.params.slug)
      .maybeSingle();
    if (!product) throw HttpError.notFound("Product not found");

    const { data, error } = await supabaseAdmin
      .from("reviews")
      .select("*")
      .eq("product_id", product.id)
      .eq("is_published", true)
      .order("created_at", { ascending: false });
    if (error) throw HttpError.internal(error.message);

    res.json((data ?? []).map(toReviewDTO));
  } catch (err) {
    next(err);
  }
});
