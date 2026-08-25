import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { can } from "../rbac/rbac.service.js";
import { logAudit } from "../rbac/audit.service.js";
import { SETTINGS, SETTINGS_BY_KEY, SENSITIVE_GROUP_PERMISSION } from "../settings/settings.catalog.js";
import { getAllSettingsGrouped, setSettings, resetGroup } from "../settings/settings.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const adminSiteSettingsRouter = Router();
adminSiteSettingsRouter.use(authenticate, requireAdmin);

/** Groups the caller lacks the extra settings.<group> permission for are omitted entirely
 * from the response — not just read-only — matching the plan's "tax/payment shouldn't even
 * be viewable by an unauthorized admin" decision. */
function visibleGroups(all: Record<string, Record<string, unknown>>, hasPerm: (slug: string) => boolean) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [group, values] of Object.entries(all)) {
    const requiredPerm = SENSITIVE_GROUP_PERMISSION[group];
    if (requiredPerm && !hasPerm(requiredPerm)) continue;
    out[group] = values;
  }
  return out;
}

adminSiteSettingsRouter.get("/", requirePermission("settings.view"), async (req, res, next) => {
  try {
    const all = await getAllSettingsGrouped();
    res.json({
      catalog: SETTINGS,
      values: visibleGroups(all, (slug) => can(req.rbac!, slug)),
    });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.record(z.string(), z.any());

adminSiteSettingsRouter.patch("/", requirePermission("settings.update"), validate(patchSchema), async (req, res, next) => {
  try {
    const patch = req.body as Record<string, unknown>;
    const touchedGroups = new Set<string>();
    for (const key of Object.keys(patch)) {
      const def = SETTINGS_BY_KEY.get(key);
      if (def) touchedGroups.add(def.group);
    }
    for (const group of touchedGroups) {
      const requiredPerm = SENSITIVE_GROUP_PERMISSION[group];
      if (requiredPerm && !can(req.rbac!, requiredPerm)) {
        throw HttpError.forbidden(`You do not have permission to edit ${group} settings.`);
      }
    }

    const result = await setSettings(patch, req.admin!.id);

    await logAudit({
      userId: req.admin!.id,
      action: "SETTINGS_UPDATED",
      resource: "settings",
      permission: "settings.update",
      // Never log values — a sensitive group's keys are still just key NAMES here, matching
      // the "changed: true, never the actual secret" audit convention.
      metadata: { groups: result.groupsTouched, keys: result.keysChanged },
      req,
    });

    const all = await getAllSettingsGrouped();
    res.json({ catalog: SETTINGS, values: visibleGroups(all, (slug) => can(req.rbac!, slug)) });
  } catch (err) {
    next(err);
  }
});

const resetSchema = z.object({ group: z.string().min(1) });

adminSiteSettingsRouter.post("/reset", requirePermission("settings.update"), validate(resetSchema), async (req, res, next) => {
  try {
    const { group } = req.body as z.infer<typeof resetSchema>;
    const requiredPerm = SENSITIVE_GROUP_PERMISSION[group];
    if (requiredPerm && !can(req.rbac!, requiredPerm)) {
      throw HttpError.forbidden(`You do not have permission to reset ${group} settings.`);
    }
    await resetGroup(group);
    await logAudit({ userId: req.admin!.id, action: "SETTINGS_UPDATED", resource: "settings", permission: "settings.update", metadata: { reset: group }, req });
    const all = await getAllSettingsGrouped();
    res.json({ catalog: SETTINGS, values: visibleGroups(all, (slug) => can(req.rbac!, slug)) });
  } catch (err) {
    next(err);
  }
});

// ---- Tax categories ----

adminSiteSettingsRouter.get("/tax-categories", requirePermission("settings.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("tax_categories").select("*").order("rate");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

const taxCategorySchema = z.object({
  name: z.string().min(1),
  rate: z.number().min(0).max(100),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

adminSiteSettingsRouter.post("/tax-categories", requirePermission("settings.tax"), validate(taxCategorySchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof taxCategorySchema>;
    if (b.isDefault) await supabaseAdmin.from("tax_categories").update({ is_default: false }).eq("is_default", true);
    const { data, error } = await supabaseAdmin
      .from("tax_categories")
      .insert({ name: b.name, rate: b.rate, is_default: b.isDefault ?? false, is_active: b.isActive ?? true })
      .select("*")
      .single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

adminSiteSettingsRouter.patch("/tax-categories/:id", requirePermission("settings.tax"), validate(taxCategorySchema.partial()), async (req, res, next) => {
  try {
    const b = req.body as Partial<z.infer<typeof taxCategorySchema>>;
    if (b.isDefault) await supabaseAdmin.from("tax_categories").update({ is_default: false }).eq("is_default", true);
    const update: Record<string, unknown> = {};
    if (b.name !== undefined) update.name = b.name;
    if (b.rate !== undefined) update.rate = b.rate;
    if (b.isDefault !== undefined) update.is_default = b.isDefault;
    if (b.isActive !== undefined) update.is_active = b.isActive;
    const { data, error } = await supabaseAdmin.from("tax_categories").update(update).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Tax category not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminSiteSettingsRouter.delete("/tax-categories/:id", requirePermission("settings.tax"), async (req, res, next) => {
  try {
    const { count } = await supabaseAdmin.from("products").select("id", { count: "exact", head: true }).eq("tax_category_id", req.params.id);
    if ((count ?? 0) > 0) throw HttpError.conflict(`${count} product(s) use this tax category. Reassign them first.`);
    const { error } = await supabaseAdmin.from("tax_categories").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Shipping zones ----

adminSiteSettingsRouter.get("/shipping-zones", requirePermission("settings.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("shipping_zones").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

const shippingZoneSchema = z.object({
  name: z.string().min(1),
  states: z.array(z.string()).default([]),
  pincodes: z.array(z.string()).default([]),
  shippingFee: z.number().min(0),
  freeShippingThreshold: z.number().min(0).optional().nullable(),
  codAvailable: z.boolean().optional(),
  deliveryMinDays: z.number().int().min(0).optional(),
  deliveryMaxDays: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

function toZoneRow(b: Partial<z.infer<typeof shippingZoneSchema>>) {
  const row: Record<string, unknown> = {};
  if (b.name !== undefined) row.name = b.name;
  if (b.states !== undefined) row.states = b.states;
  if (b.pincodes !== undefined) row.pincodes = b.pincodes;
  if (b.shippingFee !== undefined) row.shipping_fee = b.shippingFee;
  if (b.freeShippingThreshold !== undefined) row.free_shipping_threshold = b.freeShippingThreshold;
  if (b.codAvailable !== undefined) row.cod_available = b.codAvailable;
  if (b.deliveryMinDays !== undefined) row.delivery_min_days = b.deliveryMinDays;
  if (b.deliveryMaxDays !== undefined) row.delivery_max_days = b.deliveryMaxDays;
  if (b.isActive !== undefined) row.is_active = b.isActive;
  if (b.sortOrder !== undefined) row.sort_order = b.sortOrder;
  return row;
}

adminSiteSettingsRouter.post("/shipping-zones", requirePermission("settings.shipping"), validate(shippingZoneSchema), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("shipping_zones").insert(toZoneRow(req.body)).select("*").single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

adminSiteSettingsRouter.patch("/shipping-zones/:id", requirePermission("settings.shipping"), validate(shippingZoneSchema.partial()), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("shipping_zones").update(toZoneRow(req.body)).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Shipping zone not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminSiteSettingsRouter.delete("/shipping-zones/:id", requirePermission("settings.shipping"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("shipping_zones").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Navigation items ----

adminSiteSettingsRouter.get("/nav-items", requirePermission("settings.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("nav_items").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

const navItemSchema = z.object({
  label: z.string().min(1),
  url: z.string().min(1),
  parentId: z.string().uuid().optional().nullable(),
  icon: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  openInNewTab: z.boolean().optional(),
});

function toNavRow(b: Partial<z.infer<typeof navItemSchema>>) {
  const row: Record<string, unknown> = {};
  if (b.label !== undefined) row.label = b.label;
  if (b.url !== undefined) row.url = b.url;
  if (b.parentId !== undefined) row.parent_id = b.parentId;
  if (b.icon !== undefined) row.icon = b.icon;
  if (b.sortOrder !== undefined) row.sort_order = b.sortOrder;
  if (b.isActive !== undefined) row.is_active = b.isActive;
  if (b.openInNewTab !== undefined) row.open_in_new_tab = b.openInNewTab;
  return row;
}

adminSiteSettingsRouter.post("/nav-items", requirePermission("settings.storefront"), validate(navItemSchema), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("nav_items").insert(toNavRow(req.body)).select("*").single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

adminSiteSettingsRouter.patch("/nav-items/:id", requirePermission("settings.storefront"), validate(navItemSchema.partial()), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("nav_items").update(toNavRow(req.body)).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Nav item not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminSiteSettingsRouter.delete("/nav-items/:id", requirePermission("settings.storefront"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("nav_items").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Footer links ----

adminSiteSettingsRouter.get("/footer-links", requirePermission("settings.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("footer_links").select("*").order("column_key").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

const footerLinkSchema = z.object({
  columnKey: z.string().min(1),
  label: z.string().min(1),
  url: z.string().min(1),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

function toFooterRow(b: Partial<z.infer<typeof footerLinkSchema>>) {
  const row: Record<string, unknown> = {};
  if (b.columnKey !== undefined) row.column_key = b.columnKey;
  if (b.label !== undefined) row.label = b.label;
  if (b.url !== undefined) row.url = b.url;
  if (b.sortOrder !== undefined) row.sort_order = b.sortOrder;
  if (b.isActive !== undefined) row.is_active = b.isActive;
  return row;
}

adminSiteSettingsRouter.post("/footer-links", requirePermission("settings.storefront"), validate(footerLinkSchema), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("footer_links").insert(toFooterRow(req.body)).select("*").single();
    if (error) throw HttpError.internal(error.message);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

adminSiteSettingsRouter.patch("/footer-links/:id", requirePermission("settings.storefront"), validate(footerLinkSchema.partial()), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("footer_links").update(toFooterRow(req.body)).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Footer link not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});

adminSiteSettingsRouter.delete("/footer-links/:id", requirePermission("settings.storefront"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("footer_links").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Homepage sections ----

adminSiteSettingsRouter.get("/homepage-sections", requirePermission("settings.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("homepage_sections").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

const homepageSectionSchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().optional().nullable(),
  subtitle: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  buttonText: z.string().optional().nullable(),
  buttonUrl: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

adminSiteSettingsRouter.patch("/homepage-sections/:id", requirePermission("settings.storefront"), validate(homepageSectionSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof homepageSectionSchema>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.enabled !== undefined) update.enabled = b.enabled;
    if (b.title !== undefined) update.title = b.title;
    if (b.subtitle !== undefined) update.subtitle = b.subtitle;
    if (b.description !== undefined) update.description = b.description;
    if (b.imageUrl !== undefined) update.image_url = b.imageUrl;
    if (b.buttonText !== undefined) update.button_text = b.buttonText;
    if (b.buttonUrl !== undefined) update.button_url = b.buttonUrl;
    if (b.sortOrder !== undefined) update.sort_order = b.sortOrder;

    const { data, error } = await supabaseAdmin.from("homepage_sections").update(update).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Homepage section not found");
    res.json(data);
  } catch (err) {
    next(err);
  }
});
