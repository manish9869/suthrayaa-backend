import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { PRODUCT_SELECT, toProductDTO } from "../catalog/serializers.js";
import { imageUpload, uploadProductImage, deleteStorageObject, BUCKETS } from "../storage/upload.js";

export const adminProductsRouter = Router();
adminProductsRouter.use(authenticate, requireAdmin);

adminProductsRouter.get("/", async (req, res, next) => {
  try {
    const { page = "1", limit = "50", search } = req.query as Record<string, string>;
    let query = supabaseAdmin
      .from("products")
      .select(PRODUCT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false });
    if (search) query = query.ilike("name", `%${search.replace(/[%,()]/g, "")}%`);

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    query = query.range((pageNum - 1) * limitNum, pageNum * limitNum - 1);

    const { data, error, count } = await query;
    if (error) throw HttpError.internal(error.message);

    res.json({
      items: (data ?? []).map((p) => ({ ...toProductDTO(p, { includeDisabledCustomizations: true }), isActive: p.is_active })),
      total: count ?? 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

adminProductsRouter.get("/:id", async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Product not found");
    res.json({ ...toProductDTO(data, { includeDisabledCustomizations: true }), isActive: data.is_active });
  } catch (err) {
    next(err);
  }
});

const productSchema = z.object({
  sku: z.string().min(1).optional().nullable(),
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  description: z.string().default(""),
  shortDescription: z.string().default(""),
  price: z.number().min(0),
  comparePrice: z.number().min(0).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).default([]),
  stock: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).optional(),
  featured: z.boolean().optional(),
  bestseller: z.boolean().optional(),
  newArrival: z.boolean().optional(),
  isActive: z.boolean().optional(),
  estimatedDelivery: z.string().optional(),
  dimensions: z.string().optional(),
  materials: z.array(z.string()).default([]),
  careInstructions: z.array(z.string()).default([]),
  colorIds: z.array(z.string().uuid()).optional(),
  customizable: z.boolean().optional(),
});

adminProductsRouter.post("/", validate(productSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof productSchema>;
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert({
        sku: body.sku,
        name: body.name,
        slug: body.slug,
        description: body.description,
        short_description: body.shortDescription,
        price: body.price,
        compare_price: body.comparePrice,
        category_id: body.categoryId,
        tags: body.tags,
        stock: body.stock,
        low_stock_threshold: body.lowStockThreshold,
        featured: body.featured,
        bestseller: body.bestseller,
        new_arrival: body.newArrival,
        is_active: body.isActive ?? true,
        estimated_delivery: body.estimatedDelivery,
        dimensions: body.dimensions,
        materials: body.materials,
        care_instructions: body.careInstructions,
        customizable: body.customizable ?? false,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);

    await supabaseAdmin.from("customization_rules").insert({ product_id: product.id });

    if (body.colorIds?.length) {
      await supabaseAdmin
        .from("product_colors")
        .insert(body.colorIds.map((colorId, i) => ({ product_id: product.id, color_id: colorId, sort_order: i })));
    }

    const { data: full } = await supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("id", product.id).single();
    res.status(201).json(toProductDTO(full, { includeDisabledCustomizations: true }));
  } catch (err) {
    next(err);
  }
});

adminProductsRouter.patch("/:id", validate(productSchema.partial()), async (req, res, next) => {
  try {
    const body = req.body as Partial<z.infer<typeof productSchema>>;
    const patch: Record<string, unknown> = {};
    if (body.sku !== undefined) patch.sku = body.sku;
    if (body.name !== undefined) patch.name = body.name;
    if (body.slug !== undefined) patch.slug = body.slug;
    if (body.description !== undefined) patch.description = body.description;
    if (body.shortDescription !== undefined) patch.short_description = body.shortDescription;
    if (body.price !== undefined) patch.price = body.price;
    if (body.comparePrice !== undefined) patch.compare_price = body.comparePrice;
    if (body.categoryId !== undefined) patch.category_id = body.categoryId;
    if (body.tags !== undefined) patch.tags = body.tags;
    if (body.stock !== undefined) patch.stock = body.stock;
    if (body.lowStockThreshold !== undefined) patch.low_stock_threshold = body.lowStockThreshold;
    if (body.featured !== undefined) patch.featured = body.featured;
    if (body.bestseller !== undefined) patch.bestseller = body.bestseller;
    if (body.newArrival !== undefined) patch.new_arrival = body.newArrival;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    if (body.estimatedDelivery !== undefined) patch.estimated_delivery = body.estimatedDelivery;
    if (body.dimensions !== undefined) patch.dimensions = body.dimensions;
    if (body.materials !== undefined) patch.materials = body.materials;
    if (body.careInstructions !== undefined) patch.care_instructions = body.careInstructions;
    if (body.customizable !== undefined) patch.customizable = body.customizable;

    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("products").update(patch).eq("id", req.params.id);
      if (error) throw HttpError.internal(error.message);
    }

    if (body.colorIds) {
      await supabaseAdmin.from("product_colors").delete().eq("product_id", req.params.id);
      if (body.colorIds.length) {
        await supabaseAdmin
          .from("product_colors")
          .insert(body.colorIds.map((colorId, i) => ({ product_id: req.params.id, color_id: colorId, sort_order: i })));
      }
    }

    const { data: full, error: fetchErr } = await supabaseAdmin
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("id", req.params.id)
      .maybeSingle();
    if (fetchErr) throw HttpError.internal(fetchErr.message);
    if (!full) throw HttpError.notFound("Product not found");
    res.json(toProductDTO(full, { includeDisabledCustomizations: true }));
  } catch (err) {
    next(err);
  }
});

// Soft delete — keeps order history (order_items keeps a snapshot regardless) and simply
// removes the product from public catalog reads via is_active.
adminProductsRouter.delete("/:id", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("products").update({ is_active: false }).eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Images ----

adminProductsRouter.post("/:id/images", imageUpload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) throw HttpError.badRequest("No image uploaded");
    const { url, thumbnailUrl } = await uploadProductImage(BUCKETS.productImages, req.params.id, req.file.buffer);

    const { count } = await supabaseAdmin
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .eq("product_id", req.params.id);

    const { data, error } = await supabaseAdmin
      .from("product_images")
      .insert({
        product_id: req.params.id,
        url,
        alt_text: req.body.altText ?? "",
        sort_order: count ?? 0,
        is_primary: (count ?? 0) === 0,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);

    res.status(201).json({ id: data.id, url: data.url, thumbnailUrl, sortOrder: data.sort_order, isPrimary: data.is_primary });
  } catch (err) {
    next(err);
  }
});

adminProductsRouter.delete("/:id/images/:imageId", async (req, res, next) => {
  try {
    const { data: image } = await supabaseAdmin
      .from("product_images")
      .select("url")
      .eq("id", req.params.imageId)
      .maybeSingle();
    if (image?.url) {
      const path = image.url.split(`${BUCKETS.productImages}/`)[1];
      if (path) await deleteStorageObject(BUCKETS.productImages, path);
    }
    const { error } = await supabaseAdmin.from("product_images").delete().eq("id", req.params.imageId);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Customization rules (admin-controlled per-product customization limits) ----

const customizationRulesSchema = z.object({
  isCustomizable: z.boolean().optional(),
  allowColorChoice: z.boolean().optional(),
  allowText: z.boolean().optional(),
  maxTextLength: z.number().int().min(1).max(200).optional().nullable(),
  textPlaceholder: z.string().optional().nullable(),
  isLimitedEdition: z.boolean().optional(),
  adminNote: z.string().optional().nullable(),
  allowedColorIds: z.array(z.string().uuid()).optional(),
});

adminProductsRouter.patch(
  "/:id/customization-rules",
  validate(customizationRulesSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof customizationRulesSchema>;
      const patch: Record<string, unknown> = { product_id: req.params.id };
      if (body.isCustomizable !== undefined) patch.is_customizable = body.isCustomizable;
      if (body.allowColorChoice !== undefined) patch.allow_color_choice = body.allowColorChoice;
      if (body.allowText !== undefined) patch.allow_text = body.allowText;
      if (body.maxTextLength !== undefined) patch.max_text_length = body.maxTextLength;
      if (body.textPlaceholder !== undefined) patch.text_placeholder = body.textPlaceholder;
      if (body.isLimitedEdition !== undefined) patch.is_limited_edition = body.isLimitedEdition;
      if (body.adminNote !== undefined) patch.admin_note = body.adminNote;

      const { data: rule, error } = await supabaseAdmin
        .from("customization_rules")
        .upsert(patch, { onConflict: "product_id" })
        .select("*")
        .single();
      if (error) throw HttpError.internal(error.message);

      if (body.allowedColorIds) {
        await supabaseAdmin.from("customization_allowed_colors").delete().eq("customization_rule_id", rule.id);
        if (body.allowedColorIds.length) {
          await supabaseAdmin
            .from("customization_allowed_colors")
            .insert(body.allowedColorIds.map((colorId) => ({ customization_rule_id: rule.id, color_id: colorId })));
        }
      }

      const { data: full } = await supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("id", req.params.id).single();
      res.json(toProductDTO(full, { includeDisabledCustomizations: true }));
    } catch (err) {
      next(err);
    }
  }
);

// ---- Customization engine: per-product option groups + values ----

const customizationGroupSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["choice", "color", "text", "number", "checkbox"]),
  required: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  maxLength: z.number().int().min(1).max(1000).optional().nullable(),
  placeholder: z.string().optional().nullable(),
  defaultValue: z.string().optional().nullable(),
  conditionalParentValueId: z.string().uuid().optional().nullable(),
  templateId: z.string().uuid().optional().nullable(),
});

async function respondWithFullProduct(res: import("express").Response, productId: string) {
  const { data: full } = await supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("id", productId).single();
  res.json(toProductDTO(full, { includeDisabledCustomizations: true }));
}

adminProductsRouter.post(
  "/:id/customizations",
  validate(customizationGroupSchema),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof customizationGroupSchema>;
      const { error } = await supabaseAdmin.from("product_customizations").insert({
        product_id: req.params.id,
        name: b.name,
        label: b.label,
        type: b.type,
        required: b.required ?? false,
        enabled: b.enabled ?? true,
        sort_order: b.sortOrder ?? 0,
        max_length: b.maxLength,
        placeholder: b.placeholder,
        default_value: b.defaultValue,
        conditional_parent_value_id: b.conditionalParentValueId,
        template_id: b.templateId,
      });
      if (error) throw HttpError.internal(error.message);
      await respondWithFullProduct(res, req.params.id);
    } catch (err) {
      next(err);
    }
  }
);

adminProductsRouter.patch(
  "/:id/customizations/:customizationId",
  validate(customizationGroupSchema.partial()),
  async (req, res, next) => {
    try {
      const b = req.body as Partial<z.infer<typeof customizationGroupSchema>>;
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch.name = b.name;
      if (b.label !== undefined) patch.label = b.label;
      if (b.type !== undefined) patch.type = b.type;
      if (b.required !== undefined) patch.required = b.required;
      if (b.enabled !== undefined) patch.enabled = b.enabled;
      if (b.sortOrder !== undefined) patch.sort_order = b.sortOrder;
      if (b.maxLength !== undefined) patch.max_length = b.maxLength;
      if (b.placeholder !== undefined) patch.placeholder = b.placeholder;
      if (b.defaultValue !== undefined) patch.default_value = b.defaultValue;
      if (b.conditionalParentValueId !== undefined) patch.conditional_parent_value_id = b.conditionalParentValueId;

      const { error } = await supabaseAdmin
        .from("product_customizations")
        .update(patch)
        .eq("id", req.params.customizationId)
        .eq("product_id", req.params.id);
      if (error) throw HttpError.internal(error.message);
      await respondWithFullProduct(res, req.params.id);
    } catch (err) {
      next(err);
    }
  }
);

// Deletion is always safe historically: orders/cart store a resolved JSON snapshot,
// not a foreign key, so removing a group never corrupts past order data.
adminProductsRouter.delete("/:id/customizations/:customizationId", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("product_customizations")
      .delete()
      .eq("id", req.params.customizationId)
      .eq("product_id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    await respondWithFullProduct(res, req.params.id);
  } catch (err) {
    next(err);
  }
});

const customizationValueSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  priceAdjustment: z.number().optional(),
  sortOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

adminProductsRouter.post(
  "/:id/customizations/:customizationId/values",
  validate(customizationValueSchema),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof customizationValueSchema>;
      const { error } = await supabaseAdmin.from("customization_values").insert({
        customization_id: req.params.customizationId,
        label: b.label,
        value: b.value,
        price_adjustment: b.priceAdjustment ?? 0,
        sort_order: b.sortOrder ?? 0,
        enabled: b.enabled ?? true,
      });
      if (error) throw HttpError.internal(error.message);
      await respondWithFullProduct(res, req.params.id);
    } catch (err) {
      next(err);
    }
  }
);

adminProductsRouter.patch(
  "/:id/customizations/:customizationId/values/:valueId",
  validate(customizationValueSchema.partial()),
  async (req, res, next) => {
    try {
      const b = req.body as Partial<z.infer<typeof customizationValueSchema>>;
      const patch: Record<string, unknown> = {};
      if (b.label !== undefined) patch.label = b.label;
      if (b.value !== undefined) patch.value = b.value;
      if (b.priceAdjustment !== undefined) patch.price_adjustment = b.priceAdjustment;
      if (b.sortOrder !== undefined) patch.sort_order = b.sortOrder;
      if (b.enabled !== undefined) patch.enabled = b.enabled;

      const { error } = await supabaseAdmin
        .from("customization_values")
        .update(patch)
        .eq("id", req.params.valueId)
        .eq("customization_id", req.params.customizationId);
      if (error) throw HttpError.internal(error.message);
      await respondWithFullProduct(res, req.params.id);
    } catch (err) {
      next(err);
    }
  }
);

adminProductsRouter.delete("/:id/customizations/:customizationId/values/:valueId", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from("customization_values")
      .delete()
      .eq("id", req.params.valueId)
      .eq("customization_id", req.params.customizationId);
    if (error) throw HttpError.internal(error.message);
    await respondWithFullProduct(res, req.params.id);
  } catch (err) {
    next(err);
  }
});
