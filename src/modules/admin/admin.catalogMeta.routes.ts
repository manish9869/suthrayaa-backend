import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { generateUniqueSlug, isSlugTaken } from "../../lib/slug.js";

// Categories, colors, testimonials, and hero slides are all simple, low-volume CRUD
// resources with the same shape of admin needs — kept in one file rather than four
// near-identical route/controller/service triads. Testimonials are gated under the
// `content.*` permission group and hero slides under `banners.*` — the closest real
// resources to the spec's generic "content"/"banners" naming.

export const adminCategoriesRouter = Router();
export const adminColorsRouter = Router();
export const adminTestimonialsRouter = Router();
export const adminHeroSlidesRouter = Router();

for (const r of [adminCategoriesRouter, adminColorsRouter, adminTestimonialsRouter, adminHeroSlidesRouter]) {
  r.use(authenticate, requireAdmin);
}

// ---- Categories ----

const categorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only").optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  parentId: z.string().uuid().optional().nullable(),
  seoTitle: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  showInNavigation: z.boolean().optional(),
  showOnHomepage: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

// GET/POST/PATCH all speak the same camelCase shape the schema above validates —
// translated here since the underlying table is snake_case.
function toAdminCategoryDTO(row: any) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    imageUrl: row.image_url ?? "",
    sortOrder: row.sort_order ?? 0,
    isActive: row.is_active,
    parentId: row.parent_id ?? null,
    seoTitle: row.seo_title ?? "",
    seoDescription: row.seo_description ?? "",
    showInNavigation: row.show_in_navigation ?? true,
    showOnHomepage: row.show_on_homepage ?? false,
    isFeatured: row.is_featured ?? false,
  };
}

/** A category can't become its own ancestor — walk up from `candidateParentId` and reject if `id` appears. */
async function wouldCreateCycle(id: string, candidateParentId: string): Promise<boolean> {
  let current: string | null = candidateParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === id) return true;
    if (seen.has(current)) return false; // already-broken data elsewhere; don't loop forever
    seen.add(current);
    const result: { data: { parent_id: string | null } | null } = await supabaseAdmin
      .from("categories")
      .select("parent_id")
      .eq("id", current)
      .maybeSingle();
    current = result.data?.parent_id ?? null;
  }
  return false;
}

adminCategoriesRouter.get("/", requirePermission("categories.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("categories").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toAdminCategoryDTO));
  } catch (err) {
    next(err);
  }
});

adminCategoriesRouter.post("/", requirePermission("categories.create"), validate(categorySchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof categorySchema>;
    if (b.parentId) {
      const { data: parent } = await supabaseAdmin.from("categories").select("is_active").eq("id", b.parentId).maybeSingle();
      if (!parent) throw HttpError.badRequest("Parent category not found");
      if (!parent.is_active) throw HttpError.badRequest("Can't add a subcategory under an inactive category");
    }
    if (b.slug && (await isSlugTaken("categories", b.slug))) {
      throw HttpError.badRequest(`The slug "${b.slug}" is already in use by another category`);
    }
    const slug = b.slug || (await generateUniqueSlug("categories", b.name));

    const { data, error } = await supabaseAdmin
      .from("categories")
      .insert({
        name: b.name,
        slug,
        description: b.description,
        image_url: b.imageUrl,
        sort_order: b.sortOrder ?? 0,
        is_active: b.isActive ?? true,
        parent_id: b.parentId ?? null,
        seo_title: b.seoTitle,
        seo_description: b.seoDescription,
        show_in_navigation: b.showInNavigation ?? true,
        show_on_homepage: b.showOnHomepage ?? false,
        is_featured: b.isFeatured ?? false,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(toAdminCategoryDTO(data));
  } catch (err) {
    next(err);
  }
});

adminCategoriesRouter.patch("/:id", requirePermission("categories.update"), validate(categorySchema.partial()), async (req, res, next) => {
  try {
    const b = req.body as Partial<z.infer<typeof categorySchema>>;
    const update: Record<string, unknown> = {};
    if (b.name !== undefined) update.name = b.name;
    if (b.slug !== undefined) {
      if (await isSlugTaken("categories", b.slug, req.params.id)) {
        throw HttpError.badRequest(`The slug "${b.slug}" is already in use by another category`);
      }
      update.slug = b.slug;
    }
    if (b.description !== undefined) update.description = b.description;
    if (b.imageUrl !== undefined) update.image_url = b.imageUrl;
    if (b.sortOrder !== undefined) update.sort_order = b.sortOrder;
    if (b.isActive !== undefined) update.is_active = b.isActive;
    if (b.parentId !== undefined) {
      if (b.parentId === req.params.id) throw HttpError.badRequest("A category can't be its own parent");
      if (b.parentId && (await wouldCreateCycle(req.params.id, b.parentId))) {
        throw HttpError.badRequest("That would create a circular category hierarchy");
      }
      update.parent_id = b.parentId;
    }
    if (b.seoTitle !== undefined) update.seo_title = b.seoTitle;
    if (b.seoDescription !== undefined) update.seo_description = b.seoDescription;
    if (b.showInNavigation !== undefined) update.show_in_navigation = b.showInNavigation;
    if (b.showOnHomepage !== undefined) update.show_on_homepage = b.showOnHomepage;
    if (b.isFeatured !== undefined) update.is_featured = b.isFeatured;

    const { data, error } = await supabaseAdmin
      .from("categories")
      .update(update)
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Category not found");
    res.json(toAdminCategoryDTO(data));
  } catch (err) {
    next(err);
  }
});

const reorderSchema = z.object({ items: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })) });
adminCategoriesRouter.patch("/reorder", requirePermission("categories.update"), validate(reorderSchema), async (req, res, next) => {
  try {
    const { items } = req.body as z.infer<typeof reorderSchema>;
    for (const item of items) {
      const { error } = await supabaseAdmin.from("categories").update({ sort_order: item.sortOrder }).eq("id", item.id);
      if (error) throw HttpError.internal(error.message);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** What deleting this category would affect — direct children and products assigned to it. */
adminCategoriesRouter.get("/:id/impact", requirePermission("categories.view"), async (req, res, next) => {
  try {
    const { data: children } = await supabaseAdmin
      .from("categories")
      .select("id, name")
      .eq("parent_id", req.params.id)
      .eq("is_active", true);
    const { count: productCount } = await supabaseAdmin
      .from("product_categories")
      .select("product_id", { count: "exact", head: true })
      .eq("category_id", req.params.id);
    res.json({ childCategories: children ?? [], productCount: productCount ?? 0 });
  } catch (err) {
    next(err);
  }
});

const deleteCategorySchema = z.object({
  reassignTo: z.string().uuid().optional(),
  force: z.boolean().optional(),
});
adminCategoriesRouter.delete("/:id", requirePermission("categories.delete"), validate(deleteCategorySchema), async (req, res, next) => {
  try {
    const { reassignTo, force } = req.body as z.infer<typeof deleteCategorySchema>;

    const { data: children } = await supabaseAdmin
      .from("categories")
      .select("id, name")
      .eq("parent_id", req.params.id)
      .eq("is_active", true);
    if (children?.length) {
      throw HttpError.badRequest(
        `This category has ${children.length} active subcategor${children.length === 1 ? "y" : "ies"} (${children
          .map((c) => c.name)
          .join(", ")}). Deactivate or move those first.`
      );
    }

    const { data: assignments, count: productCount } = await supabaseAdmin
      .from("product_categories")
      .select("product_id", { count: "exact" })
      .eq("category_id", req.params.id);

    if ((productCount ?? 0) > 0 && !reassignTo && !force) {
      throw HttpError.conflict(`This category contains ${productCount} product${productCount === 1 ? "" : "s"}.`, {
        productCount,
      });
    }

    if ((productCount ?? 0) > 0) {
      const productIds = (assignments ?? []).map((a) => a.product_id);
      if (reassignTo) {
        await supabaseAdmin.from("products").update({ category_id: reassignTo }).in("id", productIds).eq("category_id", req.params.id);
        await supabaseAdmin.from("product_categories").update({ category_id: reassignTo }).eq("category_id", req.params.id);
      } else {
        await supabaseAdmin.from("products").update({ category_id: null }).in("id", productIds).eq("category_id", req.params.id);
        await supabaseAdmin.from("product_categories").delete().eq("category_id", req.params.id);
      }
    }

    const { error } = await supabaseAdmin.from("categories").update({ is_active: false }).eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Colors (master list used by product variants + customization rules) ----

const colorSchema = z.object({
  name: z.string().min(1),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

adminColorsRouter.get("/", requirePermission("colors.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("colors").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

adminColorsRouter.post("/", requirePermission("colors.create"), validate(colorSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof colorSchema>;
    const { data, error } = await supabaseAdmin
      .from("colors")
      .insert({ name: b.name, hex: b.hex, sort_order: b.sortOrder ?? 0, is_active: b.isActive ?? true })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

adminColorsRouter.patch("/:id", requirePermission("colors.update"), validate(colorSchema.partial()), async (req, res, next) => {
  try {
    const b = req.body as Partial<z.infer<typeof colorSchema>>;
    const { data, error } = await supabaseAdmin
      .from("colors")
      .update({ name: b.name, hex: b.hex, sort_order: b.sortOrder, is_active: b.isActive })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Color not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminColorsRouter.delete("/:id", requirePermission("colors.delete"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("colors").update({ is_active: false }).eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Testimonials ----

const testimonialSchema = z.object({
  customerName: z.string().min(1),
  location: z.string().optional(),
  content: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  avatarUrl: z.string().optional(),
  productPurchased: z.string().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

adminTestimonialsRouter.get("/", requirePermission("content.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("testimonials").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

adminTestimonialsRouter.post("/", requirePermission("content.create"), validate(testimonialSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof testimonialSchema>;
    const { data, error } = await supabaseAdmin
      .from("testimonials")
      .insert({
        customer_name: b.customerName,
        location: b.location,
        content: b.content,
        rating: b.rating,
        avatar_url: b.avatarUrl,
        product_purchased: b.productPurchased,
        is_published: b.isPublished ?? true,
        sort_order: b.sortOrder ?? 0,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

adminTestimonialsRouter.patch("/:id", requirePermission("content.update"), validate(testimonialSchema.partial()), async (req, res, next) => {
  try {
    const b = req.body as Partial<z.infer<typeof testimonialSchema>>;
    const { data, error } = await supabaseAdmin
      .from("testimonials")
      .update({
        customer_name: b.customerName,
        location: b.location,
        content: b.content,
        rating: b.rating,
        avatar_url: b.avatarUrl,
        product_purchased: b.productPurchased,
        is_published: b.isPublished,
        sort_order: b.sortOrder,
      })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Testimonial not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminTestimonialsRouter.delete("/:id", requirePermission("content.delete"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("testimonials").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Hero slides ----

const heroSlideSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  accentToken: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

adminHeroSlidesRouter.get("/", requirePermission("banners.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("hero_slides").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

adminHeroSlidesRouter.post("/", requirePermission("banners.create"), validate(heroSlideSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof heroSlideSchema>;
    const { data, error } = await supabaseAdmin
      .from("hero_slides")
      .insert({
        title: b.title,
        subtitle: b.subtitle,
        description: b.description,
        image_url: b.imageUrl,
        cta_label: b.ctaLabel,
        cta_href: b.ctaHref,
        accent_token: b.accentToken,
        sort_order: b.sortOrder ?? 0,
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

adminHeroSlidesRouter.patch("/:id", requirePermission("banners.update"), validate(heroSlideSchema.partial()), async (req, res, next) => {
  try {
    const b = req.body as Partial<z.infer<typeof heroSlideSchema>>;
    const { data, error } = await supabaseAdmin
      .from("hero_slides")
      .update({
        title: b.title,
        subtitle: b.subtitle,
        description: b.description,
        image_url: b.imageUrl,
        cta_label: b.ctaLabel,
        cta_href: b.ctaHref,
        accent_token: b.accentToken,
        sort_order: b.sortOrder,
        is_active: b.isActive,
      })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Hero slide not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminHeroSlidesRouter.delete("/:id", requirePermission("banners.delete"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("hero_slides").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
