import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requireAnyPermission, requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { HttpError } from "../../lib/httpError.js";
import { imageUpload, uploadProductImage, BUCKETS } from "../storage/upload.js";
import { logAudit } from "../rbac/audit.service.js";
import { CONTENT_ICONS } from "./content.catalog.js";
import { getAllContent, getContent, getAdminContent, saveContent, resetContent } from "./content.service.js";

// ---- Public: storefront reads ----
export const publicContentRouter = Router();

/** All content blocks (saved value or default), keyed by block key — one request per page render. */
publicContentRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getAllContent());
  } catch (err) {
    next(err);
  }
});

publicContentRouter.get("/:key", async (req, res, next) => {
  try {
    res.json(await getContent(req.params.key));
  } catch (err) {
    next(err);
  }
});

// ---- Admin: Storefront Content editor ----
export const adminContentRouter = Router();
adminContentRouter.use(authenticate, requireAdmin);

adminContentRouter.get("/", requirePermission("content.view"), async (_req, res, next) => {
  try {
    res.json({ blocks: await getAdminContent(), icons: CONTENT_ICONS });
  } catch (err) {
    next(err);
  }
});

/** Image for any content block (hero-media bucket, re-encoded to webp). Returns its public URL. */
adminContentRouter.post(
  "/upload-image",
  requireAnyPermission("content.create", "content.update"),
  imageUpload.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) throw HttpError.badRequest("No image uploaded");
      const { url } = await uploadProductImage(BUCKETS.heroMedia, "content", req.file.buffer, 2000);
      res.status(201).json({ url });
    } catch (err) {
      next(err);
    }
  }
);

adminContentRouter.put("/:key", requirePermission("content.update"), validate(z.object({ value: z.record(z.unknown()) })), async (req, res, next) => {
  try {
    const value = await saveContent(req.params.key, (req.body as { value: unknown }).value, req.admin!.id);
    await logAudit({ userId: req.admin!.id, action: "CONTENT_UPDATED", resource: "page_content", resourceId: req.params.key, permission: "content.update", req });
    res.json({ key: req.params.key, value, customized: true });
  } catch (err) {
    next(err);
  }
});

/** Reset a block to its built-in default copy. */
adminContentRouter.delete("/:key", requirePermission("content.update"), async (req, res, next) => {
  try {
    const value = await resetContent(req.params.key);
    await logAudit({
      userId: req.admin!.id,
      action: "CONTENT_UPDATED",
      resource: "page_content",
      resourceId: req.params.key,
      permission: "content.update",
      metadata: { reset: true },
      req,
    });
    res.json({ key: req.params.key, value, customized: false });
  } catch (err) {
    next(err);
  }
});
