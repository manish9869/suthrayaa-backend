import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

// Reusable customization templates (e.g. "Standard Crochet Colors") — an authoring
// convenience only. Attaching one to a product CLONES its values into that product's
// own product_customizations/customization_values rows, which the admin can then edit
// independently; there is no live link back to the template after cloning. Gated under
// `products.*` — this is product-authoring tooling, not a distinct resource of its own.
export const adminCustomizationTemplatesRouter = Router();
adminCustomizationTemplatesRouter.use(authenticate, requireAdmin);

adminCustomizationTemplatesRouter.get("/", requirePermission("products.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("customization_templates")
      .select("*, customization_template_values(*)")
      .order("created_at", { ascending: false });
    if (error) throw HttpError.internal(error.message);

    res.json(
      (data ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        values: (t.customization_template_values ?? [])
          .slice()
          .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((v: any) => ({ id: v.id, label: v.label, value: v.value, priceAdjustment: Number(v.price_adjustment ?? 0) })),
      }))
    );
  } catch (err) {
    next(err);
  }
});

const templateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["choice", "color", "text", "number", "checkbox"]),
  values: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        priceAdjustment: z.number().optional(),
      })
    )
    .default([]),
});

adminCustomizationTemplatesRouter.post("/", requirePermission("products.update"), validate(templateSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof templateSchema>;
    const { data: template, error } = await supabaseAdmin
      .from("customization_templates")
      .insert({ name: b.name, type: b.type })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);

    if (b.values.length) {
      await supabaseAdmin.from("customization_template_values").insert(
        b.values.map((v, i) => ({
          template_id: template.id,
          label: v.label,
          value: v.value,
          price_adjustment: v.priceAdjustment ?? 0,
          sort_order: i,
        }))
      );
    }

    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
});

adminCustomizationTemplatesRouter.delete("/:id", requirePermission("products.update"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("customization_templates").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Clones a template's values into a brand-new product_customizations group for the given product.
const cloneSchema = z.object({ productId: z.string().uuid() });

adminCustomizationTemplatesRouter.post(
  "/:id/clone",
  requirePermission("products.update"),
  validate(cloneSchema),
  async (req, res, next) => {
    try {
      const { productId } = req.body as z.infer<typeof cloneSchema>;
      const { data: template } = await supabaseAdmin
        .from("customization_templates")
        .select("*, customization_template_values(*)")
        .eq("id", req.params.id)
        .maybeSingle();
      if (!template) throw HttpError.notFound("Template not found");

      const { data: group, error } = await supabaseAdmin
        .from("product_customizations")
        .insert({
          product_id: productId,
          name: template.name,
          label: template.name,
          type: template.type,
          template_id: template.id,
        })
        .select("*")
        .single();
      if (error) throw HttpError.internal(error.message);

      const values = (template.customization_template_values ?? []) as any[];
      if (values.length) {
        await supabaseAdmin.from("customization_values").insert(
          values.map((v) => ({
            customization_id: group.id,
            label: v.label,
            value: v.value,
            price_adjustment: v.price_adjustment,
            sort_order: v.sort_order,
          }))
        );
      }

      res.status(201).json({ ok: true, customizationId: group.id });
    } catch (err) {
      next(err);
    }
  }
);
