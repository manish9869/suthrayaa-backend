import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { logAudit } from "../rbac/audit.service.js";
import { imageUpload, uploadPreviewImage } from "../storage/upload.js";
import { loadAdminPreviewConfig, PREVIEW_MODES } from "../preview/preview.service.js";

// Admin authoring for the live color preview. Kept in its own router (mounted on the same
// /api/admin/products prefix) so the core product routes are untouched by this feature.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminProductPreviewRouter = Router();
adminProductPreviewRouter.use(authenticate, requireAdmin);

/** Aspect ratios within 2% count as matching — masks exported from the same photo are exact. */
const ASPECT_TOLERANCE = 0.02;

adminProductPreviewRouter.get("/:id/preview", requirePermission("products.view"), async (req, res, next) => {
  try {
    const config = await loadAdminPreviewConfig(req.params.id);
    if (!config) throw HttpError.notFound("Product not found");
    res.json(config);
  } catch (err) {
    next(err instanceof HttpError ? err : HttpError.internal("Color preview is not set up yet — apply database migration 0020"));
  }
});

const previewSchema = z.object({
  mode: z.enum(PREVIEW_MODES),
  svgTemplate: z.string().max(64).optional().nullable(),
  baseUrl: z.string().url().optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  layers: z
    .array(
      z.object({
        customizationId: z.string().uuid(),
        zone: z.string().max(64).optional().nullable(),
        maskUrl: z.string().url().optional().nullable(),
      })
    )
    .max(20),
});

adminProductPreviewRouter.put("/:id/preview", requirePermission("products.update"), validate(previewSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof previewSchema>;
    const productId = req.params.id;

    // Every layer must drive off one of THIS product's color groups.
    const { data: groups, error: gErr } = await supabaseAdmin
      .from("product_customizations")
      .select("id, type")
      .eq("product_id", productId);
    if (gErr) throw HttpError.internal(gErr.message);
    const colorGroupIds = new Set((groups ?? []).filter((g: any) => g.type === "color").map((g: any) => g.id));
    for (const l of b.layers) {
      if (!colorGroupIds.has(l.customizationId)) {
        throw HttpError.badRequest("Each part must be linked to one of this product's Color customization groups");
      }
    }
    if (b.mode === "svg" && !b.svgTemplate) throw HttpError.badRequest("Choose an illustration template");
    if (b.mode === "photo" && !b.baseUrl) throw HttpError.badRequest("Upload a base photo first");

    const { error: pErr } = await supabaseAdmin
      .from("products")
      .update({
        preview_mode: b.mode,
        preview_svg_template: b.svgTemplate ?? null,
        preview_base_url: b.baseUrl ?? null,
        preview_width: b.width ?? null,
        preview_height: b.height ?? null,
      })
      .eq("id", productId);
    if (pErr) throw HttpError.internal(pErr.message);

    const { error: dErr } = await supabaseAdmin.from("product_preview_layers").delete().eq("product_id", productId);
    if (dErr) throw HttpError.internal(dErr.message);
    if (b.layers.length > 0) {
      const { error: iErr } = await supabaseAdmin.from("product_preview_layers").insert(
        b.layers.map((l, i) => ({
          product_id: productId,
          customization_id: l.customizationId,
          zone: l.zone ?? null,
          mask_url: l.maskUrl ?? null,
          sort_order: i,
        }))
      );
      if (iErr) throw HttpError.internal(iErr.message);
    }

    await logAudit({ userId: req.admin!.id, action: "PRODUCT_UPDATED", resource: "products", resourceId: productId, permission: "products.update", metadata: { colorPreview: { mode: b.mode, layers: b.layers.length } }, req });
    res.json(await loadAdminPreviewConfig(productId));
  } catch (err) {
    next(err);
  }
});

adminProductPreviewRouter.post(
  "/:id/preview/image",
  requirePermission("product_images.manage"),
  imageUpload.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) throw HttpError.badRequest("No image uploaded");
      const kind = req.body.kind === "mask" ? "mask" : "base";

      const uploaded = await uploadPreviewImage(req.params.id, kind, req.file.buffer);

      if (kind === "mask") {
        const baseW = Number(req.body.baseWidth);
        const baseH = Number(req.body.baseHeight);
        if (baseW > 0 && baseH > 0) {
          const diff = Math.abs(uploaded.width / uploaded.height - baseW / baseH) / (baseW / baseH);
          if (diff > ASPECT_TOLERANCE) {
            throw HttpError.badRequest("This mask's shape doesn't match the base photo — export it at the same size as the photo");
          }
        }
      }

      res.status(201).json(uploaded);
    } catch (err) {
      next(err);
    }
  }
);
