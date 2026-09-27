import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { DEFAULT_THEME_ID, THEME_PRESETS, THEME_PRESETS_BY_ID, THEME_TOKENS, type ThemeColors } from "./theme.presets.js";

// Theme state lives in one site_settings row (outside the settings catalog, so the Settings
// screens never show or reset it): { activeId, customThemes: [{ id, name, colors }] }.
const STATE_KEY = "theme.state";
const CACHE_TTL_MS = 60_000;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a 6-digit hex colour like #6d4aff");
export const themeColorsSchema = z.object(Object.fromEntries(THEME_TOKENS.map((t) => [t.key, hex])) as Record<keyof ThemeColors, typeof hex>);

export interface CustomTheme {
  id: string;
  name: string;
  colors: ThemeColors;
}
interface ThemeState {
  activeId: string;
  customThemes: CustomTheme[];
}

const stateSchema = z.object({
  activeId: z.string().default(DEFAULT_THEME_ID),
  customThemes: z.array(z.object({ id: z.string(), name: z.string(), colors: themeColorsSchema })).default([]),
});

let cache: ThemeState | null = null;
let cachedAt = 0;

async function loadState(): Promise<ThemeState> {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  const { data, error } = await supabaseAdmin.from("site_settings").select("value").eq("key", STATE_KEY).maybeSingle();
  if (error) throw HttpError.internal(error.message);
  const parsed = stateSchema.safeParse(data?.value ?? {});
  cache = parsed.success ? parsed.data : { activeId: DEFAULT_THEME_ID, customThemes: [] };
  cachedAt = Date.now();
  return cache;
}

async function saveState(state: ThemeState, userId: string) {
  const { error } = await supabaseAdmin
    .from("site_settings")
    .upsert({ key: STATE_KEY, value: state, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: "key" });
  if (error) throw HttpError.internal(error.message);
  cache = state;
  cachedAt = Date.now();
}

function resolveColors(state: ThemeState, id: string): ThemeColors | null {
  return THEME_PRESETS_BY_ID.get(id)?.colors ?? state.customThemes.find((t) => t.id === id)?.colors ?? null;
}

/** What the storefront needs: the active theme's colours, and whether it's the built-in default
 * (in which case the storefront applies no overrides at all). */
export async function getActiveTheme() {
  const state = await loadState();
  const colors = resolveColors(state, state.activeId);
  const activeId = colors ? state.activeId : DEFAULT_THEME_ID;
  return { id: activeId, isDefault: activeId === DEFAULT_THEME_ID, colors: colors ?? THEME_PRESETS_BY_ID.get(DEFAULT_THEME_ID)!.colors };
}

export async function getThemeAdmin() {
  const state = await loadState();
  return {
    activeId: resolveColors(state, state.activeId) ? state.activeId : DEFAULT_THEME_ID,
    defaultId: DEFAULT_THEME_ID,
    tokens: THEME_TOKENS,
    presets: THEME_PRESETS,
    customThemes: state.customThemes,
    // Invoice accent swatches for the live theme (null = default theme → reference accents)
    invoiceAccents: (() => {
      const id = resolveColors(state, state.activeId) ? state.activeId : DEFAULT_THEME_ID;
      return id === DEFAULT_THEME_ID ? null : themeInvoiceAccents(resolveColors(state, id)!);
    })(),
  };
}

export async function activateTheme(id: string, userId: string) {
  const state = await loadState();
  if (!resolveColors(state, id)) throw HttpError.notFound("Theme not found");
  await saveState({ ...state, activeId: id }, userId);
}

export async function saveCustomTheme(input: { id?: string; name: string; colors: ThemeColors }, userId: string) {
  const state = await loadState();
  if (input.id && THEME_PRESETS_BY_ID.has(input.id)) throw HttpError.badRequest("Built-in themes can't be edited — save a copy as a custom theme");
  let customThemes: CustomTheme[];
  let id = input.id;
  if (id) {
    if (!state.customThemes.some((t) => t.id === id)) throw HttpError.notFound("Custom theme not found");
    customThemes = state.customThemes.map((t) => (t.id === id ? { id: id!, name: input.name, colors: input.colors } : t));
  } else {
    if (state.customThemes.length >= 20) throw HttpError.badRequest("You can save up to 20 custom themes");
    id = `custom-${randomUUID().slice(0, 8)}`;
    customThemes = [...state.customThemes, { id, name: input.name, colors: input.colors }];
  }
  await saveState({ ...state, customThemes }, userId);
  return { id };
}

export async function deleteCustomTheme(id: string, userId: string) {
  const state = await loadState();
  if (!state.customThemes.some((t) => t.id === id)) throw HttpError.notFound("Custom theme not found");
  // Deleting the live theme falls back to the default rather than leaving the site unthemed
  const activeId = state.activeId === id ? DEFAULT_THEME_ID : state.activeId;
  await saveState({ activeId, customThemes: state.customThemes.filter((t) => t.id !== id) }, userId);
}

/** Loads/refreshes the theme cache (see app.ts's per-request warm-up) so synchronous readers —
 * email and invoice rendering — see the active theme. No-op within the TTL. */
export async function warmThemeCache(): Promise<void> {
  await loadState();
}

/** The active theme's colours, or null when the default theme is live (or the cache is cold) —
 * callers then keep their built-in brand colours unchanged. */
export function getActiveThemeColorsSync(): ThemeColors | null {
  if (!cache || cache.activeId === DEFAULT_THEME_ID) return null;
  return resolveColors(cache, cache.activeId);
}

/** Mixes two hex colours; t = weight of `b` (0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export type InvoiceAccentKey = "peach" | "violet" | "rose" | "teal";
export interface InvoiceAccent {
  name: string;
  label: string; // section labels
  wave: string; // stitched divider
  soft: string; // items-table header tint
  strong: string; // light-header ring / emphasis
}

/**
 * The four invoice accent choices re-derived from a theme (the stored keys stay peach / violet /
 * rose / teal, so a saved choice carries across themes). Used by the PDF renderer and shown as
 * swatches on Invoice Settings. Labels are pulled toward the theme ink so they stay readable.
 */
export function themeInvoiceAccents(c: ThemeColors): Record<InvoiceAccentKey, InvoiceAccent> {
  // Darken toward the theme ink just enough that small uppercase labels stay legible on white
  const readable = (hex: string) => {
    let out = hex;
    for (let t = 0.08; contrastRatio(out, "#ffffff") < 3 && t <= 0.8; t += 0.08) out = mixHex(hex, c.ink, t);
    return out;
  };
  return {
    peach: { name: "Warm", label: readable(mixHex(c.secondary, c.rose, 0.5)), wave: c.secondary, soft: c.accent, strong: c.primary },
    violet: { name: "Primary", label: readable(c.primary), wave: mixHex(c.primary, "#ffffff", 0.45), soft: c.accent, strong: c.primary },
    rose: { name: "Rose", label: readable(c.rose), wave: mixHex(c.rose, "#ffffff", 0.4), soft: mixHex(c.rose, "#ffffff", 0.9), strong: readable(mixHex(c.rose, c.ink, 0.2)) },
    teal: { name: "Soft", label: readable(c.sage), wave: c.sage, soft: mixHex(c.sage, "#ffffff", 0.78), strong: readable(c.sage) },
  };
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
