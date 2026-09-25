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
