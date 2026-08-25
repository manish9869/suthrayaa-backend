import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { can } from "../../modules/rbac/rbac.service.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { logAudit } from "../rbac/audit.service.js";
import { PRODUCT_SELECT, toProductDTO } from "../catalog/serializers.js";
import { imageUpload, uploadProductImage, deleteStorageObject, BUCKETS } from "../storage/upload.js";
import { generateUniqueSlug, isSlugTaken } from "../../lib/slug.js";

export const adminProductsRouter = Router();
adminProductsRouter.use(authenticate, requireAdmin);

adminProductsRouter.get("/", requirePermission("products.view"), async (req, res, next) => {
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
      items: (data ?? []).map((p) => ({
        ...toProductDTO(p, { includeDisabledCustomizations: true, admin: true }),
        isActive: p.is_active,
      })),
      total: count ?? 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

adminProductsRouter.get("/:id", requirePermission("products.view"), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("id", req.params.id)
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Product not found");
    res.json({ ...toProductDTO(data, { includeDisabledCustomizations: true, admin: true }), isActive: data.is_active });
  } catch (err) {
    next(err);
  }
});

const STATUS_VALUES = ["draft", "active", "hidden", "out_of_stock", "archived"] as const;
const PRODUCT_TYPE_VALUES = ["ready_to_ship", "made_to_order", "custom_order"] as const;

// A product is publicly visible for exactly two statuses: "active" (fully buyable) and
// "out_of_stock" (shown with an unbuyable badge — checkout's own stock check keeps it from
// actually being purchased). Draft/hidden/archived are never publicly queryable.
function isActiveForStatus(status: string) {
  return status === "active" || status === "out_of_stock";
}

// CR-XXXX-YYYY style code from a category name — a starting point the admin can always edit,
// not a guarantee of matching hand-picked SKUs from earlier catalog work.
function skuSegment(name: string): string {
  const firstWord = name.replace(/[^a-zA-Z\s]/g, "").trim().split(/\s+/)[0] ?? "";
  return firstWord.slice(0, 4).toUpperCase() || "GEN";
}

/**
 * Auto-suggests a SKU from the product's category — CR-{subcategory}-{leaf}-{next number}.
 * "Leaf" is the selected category itself when it has a parent, "sub" is that parent; if a
 * top-level category was selected directly (no parent), there's no natural code to build
 * from, so this returns null and the admin fills the SKU in by hand.
 */
async function generateProductSku(categoryId: string | null | undefined): Promise<string | null> {
  if (!categoryId) return null;
  const { data: category } = await supabaseAdmin
    .from("categories")
    .select("id, name, parent_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (!category?.parent_id) return null;

  const { data: parent } = await supabaseAdmin
    .from("categories")
    .select("id, name")
    .eq("id", category.parent_id)
    .maybeSingle();
  if (!parent) return null;

  const prefix = `CR-${skuSegment(parent.name)}-${skuSegment(category.name)}-`;
  const { data: existing } = await supabaseAdmin.from("products").select("sku").ilike("sku", `${prefix}%`);
  const numbers = (existing ?? [])
    .map((p) => parseInt((p.sku ?? "").slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

const productSchema = z.object({
  sku: z.string().min(1).optional().nullable(),
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only")
    .optional(),
  description: z.string().default(""),
  shortDescription: z.string().default(""),
  price: z.number().min(0),
  comparePrice: z.number().min(0).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  additionalCategoryIds: z.array(z.string().uuid()).optional(),
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
  status: z.enum(STATUS_VALUES).optional(),
  productType: z.enum(PRODUCT_TYPE_VALUES).optional(),
  processingMinDays: z.number().int().min(0).optional().nullable(),
  processingMaxDays: z.number().int().min(0).optional().nullable(),
  processingMessage: z.string().optional().nullable(),
  costPrice: z.number().min(0).optional().nullable(),
  isTaxable: z.boolean().optional(),
  taxClass: z.string().optional().nullable(),
  taxCategoryId: z.string().uuid().optional().nullable(),
  salePrice: z.number().min(0).optional().nullable(),
  saleStartDate: z.string().optional().nullable(),
  saleEndDate: z.string().optional().nullable(),
  allowBackorders: z.boolean().optional(),
  continueSellingWhenOutOfStock: z.boolean().optional(),
  trackInventory: z.boolean().optional(),
  isPhysical: z.boolean().optional(),
  weight: z.number().min(0).optional().nullable(),
  length: z.number().min(0).optional().nullable(),
  width: z.number().min(0).optional().nullable(),
  height: z.number().min(0).optional().nullable(),
  freeShipping: z.boolean().optional(),
  shippingClass: z.string().optional().nullable(),
  localPickupAvailable: z.boolean().optional(),
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  searchKeywords: z.string().optional().nullable(),
});

/** Writes the product_categories mapping (primary + additional) for a product. */
async function syncProductCategories(productId: string, categoryId: string | null | undefined, additionalIds?: string[]) {
  await supabaseAdmin.from("product_categories").delete().eq("product_id", productId);
  const rows: { product_id: string; category_id: string; is_primary: boolean }[] = [];
  if (categoryId) rows.push({ product_id: productId, category_id: categoryId, is_primary: true });
  for (const id of additionalIds ?? []) {
    if (id !== categoryId) rows.push({ product_id: productId, category_id: id, is_primary: false });
  }
  if (rows.length) await supabaseAdmin.from("product_categories").insert(rows);
}

adminProductsRouter.post("/", requirePermission("products.create"), validate(productSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof productSchema>;

    const status = body.status ?? (body.isActive === false ? "archived" : "active");
    if (isActiveForStatus(status) && !can(req.rbac!, "products.publish")) {
      throw HttpError.forbidden("You do not have permission to publish products.");
    }

    if (body.sku) {
      const { data: existingSku } = await supabaseAdmin.from("products").select("id").eq("sku", body.sku).maybeSingle();
      if (existingSku) throw HttpError.badRequest(`SKU "${body.sku}" is already in use by another product`);
    }
    const sku = body.sku || (await generateProductSku(body.categoryId));
    if (body.slug && (await isSlugTaken("products", body.slug))) {
      throw HttpError.badRequest(`The slug "${body.slug}" is already in use by another product`);
    }
    const slug = body.slug || (await generateUniqueSlug("products", body.name));

    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert({
        sku,
        name: body.name,
        slug,
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
        is_active: isActiveForStatus(status),
        status,
        estimated_delivery: body.estimatedDelivery,
        dimensions: body.dimensions,
        materials: body.materials,
        care_instructions: body.careInstructions,
        customizable: body.customizable ?? false,
        product_type: body.productType,
        processing_min_days: body.processingMinDays,
        processing_max_days: body.processingMaxDays,
        processing_message: body.processingMessage,
        cost_price: body.costPrice,
        is_taxable: body.isTaxable,
        tax_class: body.taxClass,
        tax_category_id: body.taxCategoryId,
        sale_price: body.salePrice,
        sale_start_date: body.saleStartDate,
        sale_end_date: body.saleEndDate,
        allow_backorders: body.allowBackorders,
        continue_selling_when_out_of_stock: body.continueSellingWhenOutOfStock,
        track_inventory: body.trackInventory,
        is_physical: body.isPhysical,
        weight: body.weight,
        length: body.length,
        width: body.width,
        height: body.height,
        free_shipping: body.freeShipping,
        shipping_class: body.shippingClass,
        local_pickup_available: body.localPickupAvailable,
        meta_title: body.metaTitle,
        meta_description: body.metaDescription,
        search_keywords: body.searchKeywords,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);

    await supabaseAdmin.from("customization_rules").insert({ product_id: product.id });
    await syncProductCategories(product.id, body.categoryId, body.additionalCategoryIds);

    if (body.colorIds?.length) {
      await supabaseAdmin
        .from("product_colors")
        .insert(body.colorIds.map((colorId, i) => ({ product_id: product.id, color_id: colorId, sort_order: i })));
    }

    const { data: full } = await supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("id", product.id).single();
    await logAudit({
      userId: req.admin!.id,
      action: "PRODUCT_CREATED",
      resource: "products",
      resourceId: product.id,
      permission: "products.create",
      req,
    });
    res.status(201).json({ ...toProductDTO(full, { includeDisabledCustomizations: true, admin: true }), isActive: full.is_active });
  } catch (err) {
    next(err);
  }
});

adminProductsRouter.patch("/:id", requirePermission("products.update"), validate(productSchema.partial()), async (req, res, next) => {
  try {
    const body = req.body as Partial<z.infer<typeof productSchema>>;
    const wantsLive =
      (body.status !== undefined && isActiveForStatus(body.status)) || body.isActive === true;
    if (wantsLive && !can(req.rbac!, "products.publish")) {
      throw HttpError.forbidden("You do not have permission to publish products.");
    }
    const patch: Record<string, unknown> = {};
    if (body.sku !== undefined) {
      if (body.sku && (await isSlugTaken("products", body.sku, req.params.id))) {
        throw HttpError.badRequest(`SKU "${body.sku}" is already in use by another product`);
      }
      patch.sku = body.sku;
    }
    if (body.name !== undefined) patch.name = body.name;
    if (body.slug !== undefined) {
      if (await isSlugTaken("products", body.slug, req.params.id)) {
        throw HttpError.badRequest(`The slug "${body.slug}" is already in use by another product`);
      }
      patch.slug = body.slug;
    }
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
    if (body.estimatedDelivery !== undefined) patch.estimated_delivery = body.estimatedDelivery;
    if (body.dimensions !== undefined) patch.dimensions = body.dimensions;
    if (body.materials !== undefined) patch.materials = body.materials;
    if (body.careInstructions !== undefined) patch.care_instructions = body.careInstructions;
    if (body.customizable !== undefined) patch.customizable = body.customizable;
    if (body.productType !== undefined) patch.product_type = body.productType;
    if (body.processingMinDays !== undefined) patch.processing_min_days = body.processingMinDays;
    if (body.processingMaxDays !== undefined) patch.processing_max_days = body.processingMaxDays;
    if (body.processingMessage !== undefined) patch.processing_message = body.processingMessage;
    if (body.costPrice !== undefined) patch.cost_price = body.costPrice;
    if (body.isTaxable !== undefined) patch.is_taxable = body.isTaxable;
    if (body.taxClass !== undefined) patch.tax_class = body.taxClass;
    if (body.taxCategoryId !== undefined) patch.tax_category_id = body.taxCategoryId;
    if (body.salePrice !== undefined) patch.sale_price = body.salePrice;
    if (body.saleStartDate !== undefined) patch.sale_start_date = body.saleStartDate;
    if (body.saleEndDate !== undefined) patch.sale_end_date = body.saleEndDate;
    if (body.allowBackorders !== undefined) patch.allow_backorders = body.allowBackorders;
    if (body.continueSellingWhenOutOfStock !== undefined) patch.continue_selling_when_out_of_stock = body.continueSellingWhenOutOfStock;
    if (body.trackInventory !== undefined) patch.track_inventory = body.trackInventory;
    if (body.isPhysical !== undefined) patch.is_physical = body.isPhysical;
    if (body.weight !== undefined) patch.weight = body.weight;
    if (body.length !== undefined) patch.length = body.length;
    if (body.width !== undefined) patch.width = body.width;
    if (body.height !== undefined) patch.height = body.height;
    if (body.freeShipping !== undefined) patch.free_shipping = body.freeShipping;
    if (body.shippingClass !== undefined) patch.shipping_class = body.shippingClass;
    if (body.localPickupAvailable !== undefined) patch.local_pickup_available = body.localPickupAvailable;
    if (body.metaTitle !== undefined) patch.meta_title = body.metaTitle;
    if (body.metaDescription !== undefined) patch.meta_description = body.metaDescription;
    if (body.searchKeywords !== undefined) patch.search_keywords = body.searchKeywords;

    // status is the source of truth for visibility; is_active is always kept in lockstep so
    // every existing read path that filters on is_active keeps working unchanged. A bare
    // isActive:false (no status given) is treated as archiving, for any older caller.
    if (body.status !== undefined) {
      patch.status = body.status;
      patch.is_active = isActiveForStatus(body.status);
    } else if (body.isActive !== undefined) {
      patch.is_active = body.isActive;
      patch.status = body.isActive ? "active" : "archived";
    }

    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("products").update(patch).eq("id", req.params.id);
      if (error) throw HttpError.internal(error.message);
    }

    if (body.categoryId !== undefined || body.additionalCategoryIds !== undefined) {
      const { data: current } = await supabaseAdmin.from("products").select("category_id").eq("id", req.params.id).single();
      await syncProductCategories(req.params.id, body.categoryId ?? current?.category_id ?? null, body.additionalCategoryIds);
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
    await logAudit({
      userId: req.admin!.id,
      action: "PRODUCT_UPDATED",
      resource: "products",
      resourceId: req.params.id,
      permission: "products.update",
      metadata: { fields: Object.keys(patch) },
      req,
    });
    res.json({ ...toProductDTO(full, { includeDisabledCustomizations: true, admin: true }), isActive: full.is_active });
  } catch (err) {
    next(err);
  }
});

// Duplicate an existing product — new SKU/slug required, everything else copied
// (images, customizations, and category assignment are NOT copied; admin fills those in).
adminProductsRouter.post("/:id/duplicate", requirePermission("products.create"), async (req, res, next) => {
  try {
    const { data: source, error } = await supabaseAdmin.from("products").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!source) throw HttpError.notFound("Product not found");

    const name = `${source.name} (Copy)`;
    const slug = await generateUniqueSlug("products", name);
    const { id: _id, created_at: _createdAt, updated_at: _updatedAt, sku: _sku, rating: _rating, review_count: _reviewCount, ...rest } = source;

    const { data: copy, error: insertErr } = await supabaseAdmin
      .from("products")
      .insert({ ...rest, name, slug, sku: null, status: "draft", is_active: false })
      .select("id")
      .single();
    if (insertErr) throw HttpError.internal(insertErr.message);

    await supabaseAdmin.from("customization_rules").insert({ product_id: copy.id });
    if (source.category_id) await syncProductCategories(copy.id, source.category_id, []);

    const { data: full } = await supabaseAdmin.from("products").select(PRODUCT_SELECT).eq("id", copy.id).single();
    res.status(201).json({ ...toProductDTO(full, { includeDisabledCustomizations: true, admin: true }), isActive: full.is_active });
  } catch (err) {
    next(err);
  }
});

// Soft delete — keeps order history (order_items keeps a snapshot regardless) and simply
// removes the product from public catalog reads via is_active/status.
adminProductsRouter.delete("/:id", requirePermission("products.delete"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("products").update({ is_active: false, status: "archived" }).eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    await logAudit({
      userId: req.admin!.id,
      action: "PRODUCT_DELETED",
      resource: "products",
      resourceId: req.params.id,
      permission: "products.delete",
      req,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Images ----

adminProductsRouter.post("/:id/images", requirePermission("product_images.manage"), imageUpload.single("image"), async (req, res, next) => {
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

adminProductsRouter.delete("/:id/images/:imageId", requirePermission("product_images.manage"), async (req, res, next) => {
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
  requirePermission("products.update"),
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
      res.json({ ...toProductDTO(full, { includeDisabledCustomizations: true, admin: true }), isActive: full.is_active });
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
  res.json({ ...toProductDTO(full, { includeDisabledCustomizations: true, admin: true }), isActive: full.is_active });
}

adminProductsRouter.post(
  "/:id/customizations",
  requirePermission("products.update"),
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
  requirePermission("products.update"),
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
adminProductsRouter.delete("/:id/customizations/:customizationId", requirePermission("products.update"), async (req, res, next) => {
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
  sku: z.string().optional().nullable(),
});

adminProductsRouter.post(
  "/:id/customizations/:customizationId/values",
  requirePermission("products.update"),
  validate(customizationValueSchema),
  async (req, res, next) => {
    try {
      const b = req.body as z.infer<typeof customizationValueSchema>;
      if (b.sku) {
        const { data: existing } = await supabaseAdmin.from("customization_values").select("id").eq("sku", b.sku).maybeSingle();
        if (existing) throw HttpError.badRequest(`SKU "${b.sku}" is already in use by another option value`);
      }
      const { error } = await supabaseAdmin.from("customization_values").insert({
        customization_id: req.params.customizationId,
        label: b.label,
        value: b.value,
        price_adjustment: b.priceAdjustment ?? 0,
        sort_order: b.sortOrder ?? 0,
        enabled: b.enabled ?? true,
        sku: b.sku,
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
  requirePermission("products.update"),
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
      if (b.sku !== undefined) {
        if (b.sku) {
          const { data: existing } = await supabaseAdmin
            .from("customization_values")
            .select("id")
            .eq("sku", b.sku)
            .neq("id", req.params.valueId)
            .maybeSingle();
          if (existing) throw HttpError.badRequest(`SKU "${b.sku}" is already in use by another option value`);
        }
        patch.sku = b.sku;
      }

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

adminProductsRouter.delete("/:id/customizations/:customizationId/values/:valueId", requirePermission("products.update"), async (req, res, next) => {
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
