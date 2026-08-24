import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

// Categories, colors, testimonials, and hero slides are all simple, low-volume CRUD
// resources with the same shape of admin needs — kept in one file rather than four
// near-identical route/controller/service triads.

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
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  parentId: z.string().uuid().optional().nullable(),
});

adminCategoriesRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("categories").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

adminCategoriesRouter.post("/", validate(categorySchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof categorySchema>;
    const { data, error } = await supabaseAdmin
      .from("categories")
      .insert({
        name: b.name,
        slug: b.slug,
        description: b.description,
        image_url: b.imageUrl,
        sort_order: b.sortOrder ?? 0,
        is_active: b.isActive ?? true,
        parent_id: b.parentId ?? null,
      })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

adminCategoriesRouter.patch("/:id", validate(categorySchema.partial()), async (req, res, next) => {
  try {
    const b = req.body as Partial<z.infer<typeof categorySchema>>;
    const { data, error } = await supabaseAdmin
      .from("categories")
      .update({
        name: b.name,
        slug: b.slug,
        description: b.description,
        image_url: b.imageUrl,
        sort_order: b.sortOrder,
        is_active: b.isActive,
        parent_id: b.parentId,
      })
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Category not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminCategoriesRouter.delete("/:id", async (req, res, next) => {
  try {
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

adminColorsRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("colors").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

adminColorsRouter.post("/", validate(colorSchema), async (req, res, next) => {
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

adminColorsRouter.patch("/:id", validate(colorSchema.partial()), async (req, res, next) => {
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

adminColorsRouter.delete("/:id", async (req, res, next) => {
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

adminTestimonialsRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("testimonials").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

adminTestimonialsRouter.post("/", validate(testimonialSchema), async (req, res, next) => {
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

adminTestimonialsRouter.patch("/:id", validate(testimonialSchema.partial()), async (req, res, next) => {
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

adminTestimonialsRouter.delete("/:id", async (req, res, next) => {
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

adminHeroSlidesRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("hero_slides").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

adminHeroSlidesRouter.post("/", validate(heroSlideSchema), async (req, res, next) => {
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

adminHeroSlidesRouter.patch("/:id", validate(heroSlideSchema.partial()), async (req, res, next) => {
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

adminHeroSlidesRouter.delete("/:id", async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("hero_slides").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
