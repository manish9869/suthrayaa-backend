// The store's Colors library (Admin → Colors) is the only source of customer colour choices.
// A `color` customization value belongs to the library when its hex matches an ACTIVE
// library colour — matched by hex (case-insensitive) so no schema change is needed.
//
// Same caching pattern as settings.service: per-instance, 60s TTL, warmed before each
// request (app.ts) so the synchronous serializer/checkout readers can use it.

import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

export interface LibraryColor {
  id: string;
  name: string;
  hex: string;
  family?: string;
  sortOrder: number;
}

const CACHE_TTL_MS = 60_000;
let cache: Map<string, LibraryColor> | null = null;
let cachedAt = 0;

export const normalizeHex = (hex: string) => hex.trim().toLowerCase();

async function load(): Promise<Map<string, LibraryColor>> {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  // select * so a database without the 0021 columns (family) still loads
  const { data, error } = await supabaseAdmin.from("colors").select("*").eq("is_active", true);
  if (error) throw error;
  const map = new Map<string, LibraryColor>();
  for (const c of data ?? []) {
    map.set(normalizeHex(c.hex), { id: c.id, name: c.name, hex: c.hex, family: c.family ?? undefined, sortOrder: c.sort_order ?? 0 });
  }
  cache = map;
  cachedAt = Date.now();
  return map;
}

export async function warmLibraryColors(): Promise<void> {
  await load();
}

export function invalidateLibraryColors(): void {
  cache = null;
}

/**
 * Whether a colour value is offered to customers. Fails OPEN while the cache has never
 * loaded (cold start / DB hiccup) so a transient error never empties every colour picker;
 * checkout re-checks with a fresh load.
 */
export function isLibraryHexSync(hex: string): boolean {
  if (!cache) return true;
  return cache.has(normalizeHex(hex));
}

/** The active library colour with this hex, if any (sync; see isLibraryHexSync for cold-cache behaviour). */
export function libraryColorByHexSync(hex: string): LibraryColor | undefined {
  return cache?.get(normalizeHex(hex));
}

/** Every active library colour, freshly loaded, in library order. */
export async function allLibraryColors(): Promise<LibraryColor[]> {
  return [...(await load()).values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Active library colours by id, freshly loaded — for admin writes. Throws 400 on any unknown/inactive id. */
export async function requireLibraryColors(ids: string[]): Promise<LibraryColor[]> {
  const map = await load();
  const byId = new Map([...map.values()].map((c) => [c.id, c]));
  return ids.map((id) => {
    const c = byId.get(id);
    if (!c) throw HttpError.badRequest("Pick a colour from your Colors library (it may have been deactivated)");
    return c;
  });
}
