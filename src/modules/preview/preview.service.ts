// Live color preview ("Customize & Preview") — deliberately kept out of the core catalog /
// checkout code paths. Everything here is best-effort: when the global switch is off, the
// product has no preview, the 0020 migration hasn't been applied, or any query fails, the
// callers simply get `undefined` and behave exactly as they did before this feature existed.

import { supabaseAdmin } from "../../config/supabase.js";
import { logger } from "../../lib/logger.js";
import { getSettingSync } from "../settings/settings.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PREVIEW_SETTING_KEY = "storefront.color_preview";
export const PREVIEW_MODES = ["none", "photo", "svg"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

export const REGION_TYPES = ["region", "fixed", "background"] as const;
export type RegionType = (typeof REGION_TYPES)[number];

/**
 * One region of a product photo (or one zone of an illustration). The mask is the source of
 * truth for which pixels belong to it; `customizationId` is the colour option that paints it
 * (absent for fixed/background regions). Names are informational — no logic depends on them.
 */
export interface PreviewLayerDTO {
  id: string;
  customizationId?: string;
  zone?: string;
  maskUrl?: string;
  sortOrder: number;
  name?: string;
  regionType: RegionType;
  groupId?: string;
  /** Allowed library colour ids; undefined = inherit (group → product → library). Admin only. */
  colorIds?: string[];
  allowOverlap: boolean;
  locked: boolean;
  hidden: boolean;
}

export interface PreviewGroupDTO {
  id: string;
  name: string;
  /** true: one colour option paints every region; false: one option per region. */
  sharedColor: boolean;
  colorIds?: string[];
  sortOrder: number;
}

export interface ProductPreviewDTO {
  mode: "photo" | "svg";
  svgTemplate?: string;
  baseUrl?: string;
  width?: number;
  height?: number;
  layers: PreviewLayerDTO[];
  groups: PreviewGroupDTO[];
}

/** The frozen, self-contained record of what the customer saw — stored on order_items. */
export interface PreviewSnapshot {
  mode: "photo" | "svg";
  svgTemplate?: string;
  baseUrl?: string;
  width?: number;
  height?: number;
  layers: {
    customizationId: string;
    partLabel: string;
    /** The region's own name and its group, as configured when the order was placed. */
    regionName?: string;
    groupName?: string;
    zone?: string;
    maskUrl?: string;
    hex?: string;
    colorName?: string;
  }[];
}

export function isColorPreviewEnabled(): boolean {
  try {
    return getSettingSync<boolean>(PREVIEW_SETTING_KEY) === true;
  } catch {
    return false;
  }
}

function isActiveMode(mode: unknown): mode is "photo" | "svg" {
  return mode === "photo" || mode === "svg";
}

function toLayerDTO(row: any, opts: { admin?: boolean } = {}): PreviewLayerDTO {
  return {
    id: row.id,
    customizationId: row.customization_id ?? undefined,
    zone: row.zone ?? undefined,
    maskUrl: row.mask_url ?? undefined,
    sortOrder: row.sort_order ?? 0,
    name: row.name ?? undefined,
    // rows from before migration 0021 have no region_type: they're plain regions
    regionType: (REGION_TYPES as readonly string[]).includes(row.region_type) ? row.region_type : "region",
    groupId: row.group_id ?? undefined,
    ...(opts.admin ? { colorIds: row.color_ids ?? undefined } : {}),
    allowOverlap: Boolean(row.allow_overlap),
    locked: Boolean(row.locked),
    hidden: Boolean(row.hidden),
  };
}

function toGroupDTO(row: any, opts: { admin?: boolean } = {}): PreviewGroupDTO {
  return {
    id: row.id,
    name: row.name,
    sharedColor: row.shared_color !== false,
    ...(opts.admin ? { colorIds: row.color_ids ?? undefined } : {}),
    sortOrder: row.sort_order ?? 0,
  };
}

/** Region groups for these products; [] when there are none (or migration 0021 isn't applied). */
export async function fetchGroupRows(productIds: string[]): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("product_preview_groups")
    .select("*")
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });
  if (error) return [];
  return data ?? [];
}

async function fetchLayerRows(productIds: string[]): Promise<any[] | null> {
  const { data, error } = await supabaseAdmin
    .from("product_preview_layers")
    .select("*")
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });
  if (error) {
    logger.warn({ err: error }, "Color preview layers unavailable");
    return null;
  }
  return data ?? [];
}

/**
 * Keeps only layers a customer can actually drive: linked to an enabled `color` group with
 * at least one enabled value, and carrying the asset its mode needs.
 */
function usableLayers(row: any, layerRows: any[]): PreviewLayerDTO[] {
  const colorGroups = new Set(
    (row.product_customizations ?? [])
      .filter((g: any) => g.enabled && g.type === "color" && (g.customization_values ?? []).some((v: any) => v.enabled))
      .map((g: any) => g.id)
  );
  return layerRows
    .filter((l) => !l.region_type || l.region_type === "region") // fixed/background never repaint
    .filter((l) => l.customization_id && colorGroups.has(l.customization_id))
    .filter((l) => (row.preview_mode === "svg" ? Boolean(l.zone) : Boolean(l.mask_url)))
    .map((l) => toLayerDTO(l));
}

function toPreviewDTO(row: any, layers: PreviewLayerDTO[], groupRows: any[] = []): ProductPreviewDTO {
  const used = new Set(layers.map((l) => l.groupId).filter(Boolean));
  return {
    mode: row.preview_mode,
    svgTemplate: row.preview_svg_template ?? undefined,
    baseUrl: row.preview_base_url ?? undefined,
    width: row.preview_width ?? undefined,
    height: row.preview_height ?? undefined,
    layers,
    groups: groupRows.filter((g) => used.has(g.id)).map((g) => toGroupDTO(g)),
  };
}

/**
 * The storefront preview for one product row (fetched with PRODUCT_SELECT), or undefined
 * when the feature is off / not configured / broken. Never throws.
 */
export async function loadStorefrontPreview(row: any): Promise<ProductPreviewDTO | undefined> {
  try {
    if (!isColorPreviewEnabled() || !row || !isActiveMode(row.preview_mode)) return undefined;
    if (row.preview_mode === "svg" && !row.preview_svg_template) return undefined;
    if (row.preview_mode === "photo" && !row.preview_base_url) return undefined;

    const layerRows = await fetchLayerRows([row.id]);
    if (!layerRows) return undefined;
    const layers = usableLayers(row, layerRows);
    if (layers.length === 0) return undefined;
    return toPreviewDTO(row, layers, await fetchGroupRows([row.id]));
  } catch (err) {
    logger.warn({ err, productId: row?.id }, "Color preview skipped");
    return undefined;
  }
}

/** The admin's raw, editable config — returned regardless of the global switch. */
export async function loadAdminPreviewConfig(productId: string) {
  const { data: product, error } = await supabaseAdmin
    .from("products")
    .select("id, preview_mode, preview_svg_template, preview_base_url, preview_width, preview_height")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  if (!product) return null;
  const layerRows = (await fetchLayerRows([productId])) ?? [];
  const groupRows = await fetchGroupRows([productId]);
  return {
    enabledGlobally: isColorPreviewEnabled(),
    mode: (product.preview_mode ?? "none") as PreviewMode,
    svgTemplate: product.preview_svg_template ?? undefined,
    baseUrl: product.preview_base_url ?? undefined,
    width: product.preview_width ?? undefined,
    height: product.preview_height ?? undefined,
    layers: layerRows.map((l) => toLayerDTO(l, { admin: true })),
    groups: groupRows.map((g) => toGroupDTO(g, { admin: true })),
  };
}

/**
 * Builds a preview snapshot per checkout line (same order as `lines`). Only lines whose
 * product has an active preview get one. Never throws — a failure just means no snapshot,
 * and the order is placed exactly as it would have been without this feature.
 */
export async function buildPreviewSnapshots(
  lines: { productId: string; customizations: { customizationId: string; label: string; value?: string; valueLabel?: string }[] }[]
): Promise<(PreviewSnapshot | undefined)[]> {
  const none = lines.map(() => undefined);
  try {
    if (!isColorPreviewEnabled() || lines.length === 0) return none;
    const productIds = [...new Set(lines.map((l) => l.productId))];

    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("id, preview_mode, preview_svg_template, preview_base_url, preview_width, preview_height, product_customizations(id, label, type, enabled, customization_values!customization_values_customization_id_fkey(enabled))")
      .in("id", productIds);
    if (error) return none;

    const previewProducts = (products ?? []).filter((p: any) => isActiveMode(p.preview_mode));
    if (previewProducts.length === 0) return none;

    const layerRows = await fetchLayerRows(previewProducts.map((p: any) => p.id));
    if (!layerRows) return none;
    const groupRows = await fetchGroupRows(previewProducts.map((p: any) => p.id));
    const groupName = new Map<string, string>(groupRows.map((g: any) => [g.id, g.name]));

    const byProduct = new Map<string, { row: any; layers: PreviewLayerDTO[] }>();
    for (const p of previewProducts) {
      const layers = usableLayers(p, layerRows.filter((l) => l.product_id === p.id));
      if (layers.length > 0) byProduct.set(p.id, { row: p, layers });
    }

    return lines.map((line) => {
      const entry = byProduct.get(line.productId);
      if (!entry) return undefined;
      const groupLabel = new Map<string, string>((entry.row.product_customizations ?? []).map((g: any) => [g.id, g.label]));
      const chosen = new Map(line.customizations.map((c) => [c.customizationId, c]));
      const base = toPreviewDTO(entry.row, entry.layers, groupRows);
      return {
        mode: base.mode,
        svgTemplate: base.svgTemplate,
        baseUrl: base.baseUrl,
        width: base.width,
        height: base.height,
        layers: entry.layers.map((l) => {
          const id = l.customizationId!;
          const c = chosen.get(id);
          return {
            customizationId: id,
            partLabel: c?.label ?? groupLabel.get(id) ?? "Part",
            regionName: l.name,
            groupName: l.groupId ? groupName.get(l.groupId) : undefined,
            zone: l.zone,
            maskUrl: l.maskUrl,
            hex: c?.value,
            colorName: c?.valueLabel,
          };
        }),
      };
    });
  } catch (err) {
    logger.warn({ err }, "Color preview snapshot skipped");
    return none;
  }
}
