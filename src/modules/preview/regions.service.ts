// Generic region configuration for photo colour previews. The admin divides a product
// photo into regions (arbitrary masks), optionally groups them, and says which library
// colours each may use. This turns that configuration into the customer-facing colour
// options (product_customizations of type "color") and the stored regions/groups.
//
// Nothing here knows what a product is. The only rules are structural:
//   • a region that isn't changeable gets no colour option and is never recoloured;
//   • a group with sharedColor → ONE option for all its changeable regions;
//   • any other changeable region → its OWN option (grouped ones show under the group);
//   • allowed colours: region's own list → its group's → the whole Colors library.
// Options this creates are named `preview:g:<groupId>` / `preview:r:<regionId>` so a later
// save updates them in place (keeping customers' carts valid) instead of duplicating.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "../../config/supabase.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../lib/httpError.js";
import { BUCKETS } from "../storage/upload.js";
import { allLibraryColors, normalizeHex, type LibraryColor } from "../catalog/library-colors.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_REGIONS = 200;
const MAX_GROUPS = 100;
export const PREVIEW_OPTION_PREFIX = "preview:";

const uuid = z.string().uuid();
const colorIds = z.array(uuid).max(500).nullable().optional();

export const regionConfigSchema = z.object({
  baseUrl: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Mask of the NON-product area (white = background). Stored for the editor; never recoloured. */
  backgroundMaskUrl: z.string().url().nullable().optional(),
  groups: z
    .array(
      z.object({
        id: uuid,
        name: z.string().trim().min(1).max(60),
        sharedColor: z.boolean(),
        colorIds,
      })
    )
    .max(MAX_GROUPS),
  regions: z
    .array(
      z.object({
        id: uuid,
        name: z.string().trim().min(1).max(60),
        maskUrl: z.string().url(),
        groupId: uuid.nullable().optional(),
        changeable: z.boolean(),
        colorIds,
        allowOverlap: z.boolean().optional(),
        locked: z.boolean().optional(),
        hidden: z.boolean().optional(),
        /** The region's typical colour in the photo — the customer's "Original" swatch. */
        hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      })
    )
    .max(MAX_REGIONS),
  /** Also delete colour options that aren't part of this preview (e.g. older ones). */
  removeOtherColourOptions: z.boolean().optional(),
});
export type RegionConfigInput = z.infer<typeof regionConfigSchema>;

/** Preview images must be this product's own uploads — never arbitrary external URLs. */
export function isOwnPreviewUrl(productId: string, url: string): boolean {
  const prefix = `${env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/public/${BUCKETS.productImages}/${productId}/preview/`;
  return url.startsWith(prefix) && !url.slice(prefix.length).includes("..");
}

interface OptionPlan {
  key: string; // preview:g:<id> | preview:r:<id>
  label: string;
  colors: LibraryColor[];
  sortOrder: number;
  /** Photo colour of the (first) region it paints. */
  originalHex?: string;
}

/** Works out the colour options a configuration needs, and which option paints each region. */
export function planOptions(input: RegionConfigInput, library: LibraryColor[], productPalette: LibraryColor[]) {
  const byId = new Map(library.map((c) => [c.id, c]));
  const resolve = (ids: string[] | null | undefined, fallback: LibraryColor[], where: string): LibraryColor[] => {
    if (!ids) return fallback;
    const picked = ids.map((id) => {
      const c = byId.get(id);
      if (!c) throw HttpError.badRequest(`${where}: a colour isn't in your Colors library (it may have been deactivated)`);
      return c;
    });
    return picked.sort((a, b) => a.sortOrder - b.sortOrder);
  };

  const groups = new Map(input.groups.map((g) => [g.id, g]));
  const options = new Map<string, OptionPlan>();
  const regionOption = new Map<string, string>(); // region id -> option key
  let order = 0;

  input.regions.forEach((r) => {
    if (!r.changeable) return;
    const g = r.groupId ? groups.get(r.groupId) : undefined;
    if (r.groupId && !g) throw HttpError.badRequest(`Region “${r.name}” belongs to a group that isn't in this configuration`);
    const groupColors = g ? resolve(g.colorIds, productPalette, `Group “${g.name}”`) : productPalette;
    if (g?.sharedColor) {
      const key = `${PREVIEW_OPTION_PREFIX}g:${g.id}`;
      if (!options.has(key)) options.set(key, { key, label: g.name, colors: groupColors, sortOrder: 100 + order++, originalHex: r.hex });
      regionOption.set(r.id, key);
    } else {
      const key = `${PREVIEW_OPTION_PREFIX}r:${r.id}`;
      options.set(key, { key, label: r.name, colors: resolve(r.colorIds, groupColors, `Region “${r.name}”`), sortOrder: 100 + order++, originalHex: r.hex });
      regionOption.set(r.id, key);
    }
  });

  for (const o of options.values()) {
    if (o.colors.length === 0) throw HttpError.badRequest(`“${o.label}” has no colours to choose from`);
  }
  return { options: [...options.values()], regionOption };
}

function validateStructure(productId: string, input: RegionConfigInput) {
  const ids = new Set<string>();
  for (const x of [...input.groups, ...input.regions]) {
    if (ids.has(x.id)) throw HttpError.badRequest("Each region and group needs its own id");
    ids.add(x.id);
  }
  const urls = [input.baseUrl, ...(input.backgroundMaskUrl ? [input.backgroundMaskUrl] : []), ...input.regions.map((r) => r.maskUrl)];
  if (!urls.every((u) => isOwnPreviewUrl(productId, u))) throw HttpError.badRequest("Preview images must be uploaded for this product first");
  if (!input.regions.some((r) => r.changeable)) throw HttpError.badRequest("Make at least one region changeable");
}

/** Region/group ids are client-generated: make sure none of them belongs to another product
 * (an upsert would otherwise overwrite that product's rows). */
async function assertIdsAreThisProducts(productId: string, input: RegionConfigInput) {
  const regionIds = input.regions.map((r) => r.id);
  const groupIds = input.groups.map((g) => g.id);
  const [layers, groups] = await Promise.all([
    regionIds.length ? supabaseAdmin.from("product_preview_layers").select("id, product_id").in("id", regionIds) : Promise.resolve({ data: [], error: null }),
    groupIds.length ? supabaseAdmin.from("product_preview_groups").select("id, product_id").in("id", groupIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const foreign = [...((layers.data as any[]) ?? []), ...((groups.data as any[]) ?? [])].some((row) => row.product_id !== productId);
  if (foreign) throw HttpError.badRequest("Those regions belong to a different product");
}

/**
 * What a region/group with no colour list of its own offers: the whole Colors library. (A
 * product's own "Colors" usually lists just the colour it's shown in, so inheriting those would
 * leave customers one choice; the editor offers them as a one-click list instead.)
 */
async function productPalette(_productId: string, library: LibraryColor[]): Promise<LibraryColor[]> {
  return library;
}

/** Makes one colour option match its plan: label, order, and exactly the planned colours enabled. */
async function syncOption(productId: string, plan: OptionPlan, existing: any | undefined): Promise<string> {
  let optionId = existing?.id as string | undefined;
  if (optionId) {
    const { error } = await supabaseAdmin
      .from("product_customizations")
      .update({ label: plan.label, type: "color", enabled: true, required: existing.required ?? false, sort_order: plan.sortOrder, default_value: plan.originalHex ?? null })
      .eq("id", optionId);
    if (error) throw HttpError.internal(error.message);
  } else {
    const { data, error } = await supabaseAdmin
      .from("product_customizations")
      .insert({ product_id: productId, name: plan.key, label: plan.label, type: "color", required: false, enabled: true, sort_order: plan.sortOrder, default_value: plan.originalHex ?? null })
      .select("id")
      .single();
    if (error || !data) throw HttpError.internal(error?.message ?? "Could not create the colour option");
    optionId = data.id as string;
  }

  const current: any[] = existing?.customization_values ?? [];
  const wanted = new Map(plan.colors.map((c, i) => [normalizeHex(c.hex), { c, i }]));
  const have = new Set<string>();
  const switchOff: string[] = [];
  for (const v of current) {
    const hex = normalizeHex(v.value);
    const w = wanted.get(hex);
    have.add(hex);
    // keep rows (past carts point at them) — just switch colours on/off; only write what changed
    if (!w) {
      if (v.enabled) switchOff.push(v.id);
      continue;
    }
    if (v.enabled && v.label === w.c.name && v.value === w.c.hex && v.sort_order === w.i) continue;
    const { error } = await supabaseAdmin.from("customization_values").update({ enabled: true, label: w.c.name, value: w.c.hex, sort_order: w.i }).eq("id", v.id);
    if (error) throw HttpError.internal(error.message);
  }
  if (switchOff.length > 0) {
    const { error } = await supabaseAdmin.from("customization_values").update({ enabled: false }).in("id", switchOff);
    if (error) throw HttpError.internal(error.message);
  }
  const missing = [...wanted.entries()].filter(([hex]) => !have.has(hex));
  if (missing.length > 0) {
    const { error } = await supabaseAdmin.from("customization_values").insert(
      missing.map(([, { c, i }]) => ({ customization_id: optionId, label: c.name, value: c.hex, price_adjustment: 0, sort_order: i, enabled: true }))
    );
    if (error) throw HttpError.internal(error.message);
  }
  return optionId;
}

export async function saveRegionConfig(productId: string, input: RegionConfigInput) {
  const { data: product, error: pErr } = await supabaseAdmin.from("products").select("id").eq("id", productId).maybeSingle();
  if (pErr) throw HttpError.internal(pErr.message);
  if (!product) throw HttpError.notFound("Product not found");

  validateStructure(productId, input);
  const library = await allLibraryColors();
  if (library.length === 0) throw HttpError.badRequest("Add colours to your Colors library first");
  const { options, regionOption } = planOptions(input, library, await productPalette(productId, library));

  // current colour options of this product
  const { data: existingRows, error: eErr } = await supabaseAdmin
    .from("product_customizations")
    .select("id, name, label, type, required, customization_values!customization_values_customization_id_fkey(id, label, value, enabled, sort_order)")
    .eq("product_id", productId)
    .eq("type", "color");
  if (eErr) throw HttpError.internal(eErr.message);
  const existingByName = new Map((existingRows ?? []).map((g: any) => [g.name, g]));
  const existingById = new Map((existingRows ?? []).map((g: any) => [g.id, g]));

  const { data: oldLayers, error: lErr } = await supabaseAdmin.from("product_preview_layers").select("id, zone, customization_id, region_type").eq("product_id", productId);
  if (lErr) throw HttpError.internal(lErr.message);
  await assertIdsAreThisProducts(productId, input);
  const oldOptionOfRegion = new Map((oldLayers ?? []).map((l: any) => [l.id, l.customization_id]));

  // A region that already had an option (e.g. set up before this editor) keeps it — renamed
  // to its new key — so carts holding that option stay valid.
  const adopted = new Set<string>();
  const optionIdByKey = new Map<string, string>();
  for (const plan of options) {
    let existing = existingByName.get(plan.key);
    if (!existing) {
      const regionIds = [...regionOption.entries()].filter(([, key]) => key === plan.key).map(([id]) => id);
      const candidate = regionIds.map((id) => existingById.get(oldOptionOfRegion.get(id))).find((g: any) => g && !adopted.has(g.id) && !String(g.name).startsWith(PREVIEW_OPTION_PREFIX));
      if (candidate) {
        const { error } = await supabaseAdmin.from("product_customizations").update({ name: plan.key }).eq("id", candidate.id);
        if (error) throw HttpError.internal(error.message);
        existing = candidate;
      }
    }
    if (existing) adopted.add(existing.id);
    optionIdByKey.set(plan.key, await syncOption(productId, plan, existing));
  }

  // regions + groups. Write the new ones FIRST (upsert by id, every row with the same
  // columns — PostgREST fills a column missing from some rows with NULL, not its default),
  // and only then remove what's gone, so a failed write never leaves a product without regions.
  const { data: oldGroups, error: ogErr } = await supabaseAdmin.from("product_preview_groups").select("id").eq("product_id", productId);
  if (ogErr) throw HttpError.internal(ogErr.message.includes("does not exist") ? "Apply database migration 0021 first" : ogErr.message);

  if (input.groups.length > 0) {
    const { error } = await supabaseAdmin.from("product_preview_groups").upsert(
      input.groups.map((g, i) => ({ id: g.id, product_id: productId, name: g.name, shared_color: g.sharedColor, color_ids: g.colorIds ?? null, sort_order: i })),
      { onConflict: "id" }
    );
    if (error) throw HttpError.internal(error.message);
  }

  const background = (oldLayers ?? []).find((l: any) => l.region_type === "background");
  const layerRow = (row: {
    id: string;
    customization_id: string | null;
    name: string;
    region_type: "region" | "fixed" | "background";
    group_id: string | null;
    mask_url: string;
    color_ids: string[] | null;
    allow_overlap: boolean;
    locked: boolean;
    hidden: boolean;
    sort_order: number;
  }) => ({ product_id: productId, zone: null, ...row });
  const rows = input.regions.map((r, i) => {
    const key = regionOption.get(r.id);
    return layerRow({
      id: r.id,
      customization_id: key ? optionIdByKey.get(key) ?? null : null,
      name: r.name,
      region_type: r.changeable ? "region" : "fixed",
      group_id: r.groupId ?? null,
      mask_url: r.maskUrl,
      color_ids: r.colorIds ?? null,
      allow_overlap: r.allowOverlap ?? false,
      locked: r.locked ?? false,
      hidden: r.hidden ?? false,
      sort_order: i,
    });
  });
  if (input.backgroundMaskUrl) {
    rows.push(
      layerRow({
        id: background?.id ?? randomUUID(),
        customization_id: null,
        name: "Background",
        region_type: "background",
        group_id: null,
        mask_url: input.backgroundMaskUrl,
        color_ids: null,
        allow_overlap: false,
        locked: false,
        hidden: false,
        sort_order: -1,
      })
    );
  }
  if (rows.length > 0) {
    const { error } = await supabaseAdmin.from("product_preview_layers").upsert(rows, { onConflict: "id" });
    if (error) throw HttpError.internal(error.message.includes("column") ? "Apply database migration 0021 first" : error.message);
  }

  // now remove photo regions and groups that are no longer in the configuration
  const keepLayers = new Set(rows.map((r) => r.id));
  const goneLayers = (oldLayers ?? []).filter((l: any) => l.zone == null && !keepLayers.has(l.id)).map((l: any) => l.id);
  if (goneLayers.length > 0) {
    const { error } = await supabaseAdmin.from("product_preview_layers").delete().in("id", goneLayers);
    if (error) throw HttpError.internal(error.message);
  }
  const keepGroups = new Set(input.groups.map((g) => g.id));
  const goneGroups = (oldGroups ?? []).filter((g: any) => !keepGroups.has(g.id)).map((g: any) => g.id);
  if (goneGroups.length > 0) {
    const { error } = await supabaseAdmin.from("product_preview_groups").delete().in("id", goneGroups);
    if (error) throw HttpError.internal(error.message);
  }

  // colour options no longer used by the preview
  const used = new Set(optionIdByKey.values());
  const stale = (existingRows ?? []).filter(
    (g: any) => !used.has(g.id) && (String(g.name).startsWith(PREVIEW_OPTION_PREFIX) || input.removeOtherColourOptions)
  );
  if (stale.length > 0) {
    const { error } = await supabaseAdmin.from("product_customizations").delete().in("id", stale.map((g: any) => g.id));
    if (error) throw HttpError.internal(error.message);
  }

  const { error: uErr } = await supabaseAdmin
    .from("products")
    .update({ preview_mode: "photo", preview_base_url: input.baseUrl, preview_width: input.width, preview_height: input.height })
    .eq("id", productId);
  if (uErr) throw HttpError.internal(uErr.message);

  return { options: options.length, regions: input.regions.length, groups: input.groups.length, removedOptions: stale.length };
}
