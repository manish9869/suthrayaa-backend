import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { SETTINGS, SETTINGS_BY_KEY, groupKeys, type SettingDef } from "./settings.catalog.js";

// Single in-process cache, matching the RBAC work's reasoning: this backend is one Node
// process, no Redis in this stack, and settings changes are rare admin actions — a full
// re-read on every write (not a hot path) keeps this simple and always-correct.
let cache: Map<string, unknown> | null = null;

async function loadCache(): Promise<Map<string, unknown>> {
  if (cache) return cache;
  const { data, error } = await supabaseAdmin.from("site_settings").select("key, value");
  if (error) throw error;
  const map = new Map<string, unknown>();
  for (const s of SETTINGS) map.set(s.key, s.default);
  for (const row of data ?? []) map.set(row.key, row.value);
  cache = map;
  return map;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** Eagerly populates the cache — call once at server startup so the very first request
 * (e.g. a price format in a log line) already reflects stored overrides, not just defaults.
 * Not required for correctness (catalog defaults are already correct India-first values),
 * just avoids a redundant lazy-load on the first real settings read. */
export async function warmSettingsCache(): Promise<void> {
  await loadCache();
}

/** Synchronous read for hot paths that can't await (e.g. formatPrice, called from dozens of
 * existing sync call sites). Falls back to the catalog default if the cache hasn't been
 * populated yet — which, since every default is already a correct India-first value, means
 * behavior is identical to before this cache existed even on a cold start. */
export function getSettingSync<T = unknown>(key: string): T {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting key: ${key}`);
  return coerce(def, cache?.get(key)) as T;
}

function coerce(def: SettingDef, raw: unknown): unknown {
  if (raw === undefined || raw === null) return def.default;
  switch (def.type) {
    case "boolean":
      return Boolean(raw);
    case "number":
      return typeof raw === "number" ? raw : Number(raw);
    default:
      return String(raw);
  }
}

/** Fetches one setting's current (typed, defaulted) value. */
export async function getSetting<T = unknown>(key: string): Promise<T> {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting key: ${key}`);
  const map = await loadCache();
  return coerce(def, map.get(key)) as T;
}

export async function getSettingsMap(keys: string[]): Promise<Record<string, unknown>> {
  const map = await loadCache();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const def = SETTINGS_BY_KEY.get(key);
    if (def) out[key] = coerce(def, map.get(key));
  }
  return out;
}

/** Every setting, current values, grouped by `group` — the shape the admin UI renders. */
export async function getAllSettingsGrouped(): Promise<Record<string, Record<string, unknown>>> {
  const map = await loadCache();
  const groups: Record<string, Record<string, unknown>> = {};
  for (const def of SETTINGS) {
    groups[def.group] ??= {};
    groups[def.group][def.key] = coerce(def, map.get(def.key));
  }
  return groups;
}

/** Only `isPublic` settings, grouped — what GET /api/site-settings/public returns. Filtering
 * happens here, not by the route trusting a query param, so a sensitive key can never leak
 * through a route-level mistake. */
export async function getPublicSettingsGrouped(): Promise<Record<string, Record<string, unknown>>> {
  const map = await loadCache();
  const groups: Record<string, Record<string, unknown>> = {};
  for (const def of SETTINGS) {
    if (!def.isPublic) continue;
    groups[def.group] ??= {};
    groups[def.group][def.key] = coerce(def, map.get(def.key));
  }
  return groups;
}

function validateValue(def: SettingDef, value: unknown): unknown {
  switch (def.type) {
    case "boolean":
      if (typeof value !== "boolean") throw HttpError.badRequest(`${def.key} must be a boolean`);
      return value;
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) throw HttpError.badRequest(`${def.key} must be a number`);
      return n;
    }
    case "select": {
      const s = String(value);
      if (def.options && !def.options.includes(s)) throw HttpError.badRequest(`${def.key} must be one of: ${def.options.join(", ")}`);
      return s;
    }
    case "url":
      if (value !== "" && typeof value === "string") {
        const isRelative = value.startsWith("/");
        const isAbsolute = /^https?:\/\//i.test(value);
        if (!isRelative && !isAbsolute) throw HttpError.badRequest(`${def.key} must be a valid URL`);
      }
      return String(value ?? "");
    case "email":
      if (value !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        throw HttpError.badRequest(`${def.key} must be a valid email address`);
      }
      return String(value ?? "");
    case "color":
      if (!/^#[0-9A-Fa-f]{6}$/.test(String(value))) throw HttpError.badRequest(`${def.key} must be a hex color`);
      return String(value);
    default:
      return String(value ?? "");
  }
}

/** Validates + upserts a patch of {key: value} pairs against the catalog. Rejects any key
 * not in the catalog rather than silently storing it (spec: "unknown key in a PATCH is
 * rejected, not silently stored"). Returns the groups touched, for audit logging. */
export async function setSettings(patch: Record<string, unknown>, userId: string): Promise<{ groupsTouched: string[]; keysChanged: string[] }> {
  const rows: { key: string; value: unknown; updated_by: string }[] = [];
  const groupsTouched = new Set<string>();

  for (const [key, rawValue] of Object.entries(patch)) {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) throw HttpError.badRequest(`Unknown setting key: ${key}`);
    const value = validateValue(def, rawValue);
    rows.push({ key, value, updated_by: userId });
    groupsTouched.add(def.group);
  }
  if (!rows.length) return { groupsTouched: [], keysChanged: [] };

  const { error } = await supabaseAdmin.from("site_settings").upsert(rows, { onConflict: "key" });
  if (error) throw HttpError.internal(error.message);

  invalidateSettingsCache();
  return { groupsTouched: Array.from(groupsTouched), keysChanged: Object.keys(patch) };
}

/** Deletes every stored value for a group so the catalog defaults apply again. */
export async function resetGroup(group: string): Promise<void> {
  const keys = groupKeys(group);
  if (!keys.length) throw HttpError.badRequest(`Unknown setting group: ${group}`);
  const { error } = await supabaseAdmin.from("site_settings").delete().in("key", keys);
  if (error) throw HttpError.internal(error.message);
  invalidateSettingsCache();
}
