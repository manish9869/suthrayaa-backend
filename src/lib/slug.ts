import { supabaseAdmin } from "../config/supabase.js";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Turns a name into a unique slug for the given table, auto-appending -2, -3, ... on
 * collision. Used when the admin didn't type a slug themselves — an explicit admin-chosen
 * slug that collides should surface as a validation error instead (see admin routes).
 */
export async function generateUniqueSlug(table: string, name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || "item";
  let candidate = base;
  let suffix = 2;
  for (;;) {
    let query = supabaseAdmin.from(table).select("id").eq("slug", candidate);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query.maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

/** True if `slug` is already used by another row in `table` (excluding excludeId, for edits). */
export async function isSlugTaken(table: string, slug: string, excludeId?: string): Promise<boolean> {
  let query = supabaseAdmin.from(table).select("id").eq("slug", slug);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.maybeSingle();
  return Boolean(data);
}
