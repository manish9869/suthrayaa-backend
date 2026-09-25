import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { logAudit } from "../rbac/audit.service.js";
import { activateTheme, deleteCustomTheme, getActiveTheme, getThemeAdmin, saveCustomTheme, themeColorsSchema } from "./theme.service.js";

// ---- Public: the storefront reads the active theme on every render (cached) ----
export const publicThemeRouter = Router();

publicThemeRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getActiveTheme());
  } catch (err) {
    next(err);
  }
});

// ---- Admin: Theme management (Admin → Theme) ----
export const adminThemeRouter = Router();
adminThemeRouter.use(authenticate, requireAdmin);

adminThemeRouter.get("/", requirePermission("settings.view"), async (_req, res, next) => {
  try {
    res.json(await getThemeAdmin());
  } catch (err) {
    next(err);
  }
});

/** Make a built-in or custom theme live on the storefront. */
adminThemeRouter.put("/active", requirePermission("settings.branding"), validate(z.object({ id: z.string().min(1) })), async (req, res, next) => {
  try {
    const { id } = req.body as { id: string };
    await activateTheme(id, req.admin!.id);
    await logAudit({ userId: req.admin!.id, action: "SETTINGS_UPDATED", resource: "theme", resourceId: id, permission: "settings.branding", metadata: { activated: id }, req });
    res.json(await getThemeAdmin());
  } catch (err) {
    next(err);
  }
});

const customSchema = z.object({ name: z.string().trim().min(1).max(60), colors: themeColorsSchema });

adminThemeRouter.post("/custom", requirePermission("settings.branding"), validate(customSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof customSchema>;
    const { id } = await saveCustomTheme(body, req.admin!.id);
    await logAudit({ userId: req.admin!.id, action: "SETTINGS_UPDATED", resource: "theme", resourceId: id, permission: "settings.branding", metadata: { created: body.name }, req });
    res.status(201).json({ id, ...(await getThemeAdmin()) });
  } catch (err) {
    next(err);
  }
});

adminThemeRouter.put("/custom/:id", requirePermission("settings.branding"), validate(customSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof customSchema>;
    await saveCustomTheme({ id: req.params.id, ...body }, req.admin!.id);
    await logAudit({ userId: req.admin!.id, action: "SETTINGS_UPDATED", resource: "theme", resourceId: req.params.id, permission: "settings.branding", metadata: { updated: body.name }, req });
    res.json({ id: req.params.id, ...(await getThemeAdmin()) });
  } catch (err) {
    next(err);
  }
});

adminThemeRouter.delete("/custom/:id", requirePermission("settings.branding"), async (req, res, next) => {
  try {
    await deleteCustomTheme(req.params.id, req.admin!.id);
    await logAudit({ userId: req.admin!.id, action: "SETTINGS_UPDATED", resource: "theme", resourceId: req.params.id, permission: "settings.branding", metadata: { deleted: true }, req });
    res.json(await getThemeAdmin());
  } catch (err) {
    next(err);
  }
});
