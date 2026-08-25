import { Router } from "express";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { getPublicSettingsGrouped } from "./settings.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Public, unauthenticated — mirrors the existing pattern for hero-slides/testimonials/etc.
// Filtering to isPublic-only keys happens inside settings.service, not here, so a route-level
// mistake can never leak a sensitive key.
export const publicSettingsRouter = Router();

publicSettingsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getPublicSettingsGrouped());
  } catch (err) {
    next(err);
  }
});

export const publicNavRouter = Router();
publicNavRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("nav_items").select("*").eq("is_active", true).order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(
      (data ?? []).map((n: any) => ({
        id: n.id,
        label: n.label,
        url: n.url,
        parentId: n.parent_id,
        icon: n.icon,
        sortOrder: n.sort_order,
        openInNewTab: n.open_in_new_tab,
      }))
    );
  } catch (err) {
    next(err);
  }
});

export const publicFooterRouter = Router();
publicFooterRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("footer_links").select("*").eq("is_active", true).order("column_key").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map((f: any) => ({ id: f.id, columnKey: f.column_key, label: f.label, url: f.url, sortOrder: f.sort_order })));
  } catch (err) {
    next(err);
  }
});

export const publicHomepageSectionsRouter = Router();
publicHomepageSectionsRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("homepage_sections").select("*").order("sort_order");
    if (error) throw HttpError.internal(error.message);
    res.json(
      (data ?? []).map((s: any) => ({
        sectionKey: s.section_key,
        enabled: s.enabled,
        title: s.title,
        subtitle: s.subtitle,
        description: s.description,
        imageUrl: s.image_url,
        buttonText: s.button_text,
        buttonUrl: s.button_url,
        sortOrder: s.sort_order,
      }))
    );
  } catch (err) {
    next(err);
  }
});
