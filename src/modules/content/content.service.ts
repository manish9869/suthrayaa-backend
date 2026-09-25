import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { logger } from "../../lib/logger.js";
import { CONTENT_BLOCKS, CONTENT_BLOCKS_BY_KEY, blockSchema } from "./content.catalog.js";

// Stored overrides from `page_content`, cached per instance for CACHE_TTL_MS (same pattern and
// window as the settings cache — other serverless instances pick up an edit within a minute).
const CACHE_TTL_MS = 60_000;
let cache: Map<string, { value: unknown; updatedAt: string }> | null = null;
let cachedAt = 0;

async function loadStored() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  const { data, error } = await supabaseAdmin.from("page_content").select("key, value, updated_at");
  if (error) {
    // Table not created yet (migration 0015 pending): serve the catalog defaults instead of failing
    if (error.code === "42P01" || error.code === "PGRST205") {
      logger.warn("page_content table missing — run supabase/migrations/0015_storefront_cms.sql; serving default content");
      return new Map<string, { value: unknown; updatedAt: string }>();
    }
    throw HttpError.internal(error.message);
  }
  cache = new Map((data ?? []).map((r) => [r.key as string, { value: r.value, updatedAt: r.updated_at as string }]));
  cachedAt = Date.now();
  return cache;
}

function resolve(key: string, stored: unknown) {
  const block = CONTENT_BLOCKS_BY_KEY.get(key)!;
  if (stored === undefined) return block.default;
  // Re-validate on read so a catalog change (new field) never hands the storefront a stale shape;
  // fields missing from an older saved value fall back to that field's default.
  const parsed = blockSchema(block).safeParse({ ...block.default, ...(stored as object) });
  return parsed.success ? parsed.data : block.default;
}

/** Every block's effective value (saved override or default), keyed by block key. */
export async function getAllContent(): Promise<Record<string, unknown>> {
  const stored = await loadStored();
  return Object.fromEntries(CONTENT_BLOCKS.map((b) => [b.key, resolve(b.key, stored.get(b.key)?.value)]));
}

export async function getContent(key: string): Promise<unknown> {
  if (!CONTENT_BLOCKS_BY_KEY.has(key)) throw HttpError.notFound("Unknown content block");
  const stored = await loadStored();
  return resolve(key, stored.get(key)?.value);
}

/** Admin view: catalog + effective value + whether it's customised. */
export async function getAdminContent() {
  const stored = await loadStored();
  return CONTENT_BLOCKS.map((b) => ({
    key: b.key,
    group: b.group,
    label: b.label,
    description: b.description,
    previewPath: b.previewPath,
    fields: b.fields,
    default: b.default,
    value: resolve(b.key, stored.get(b.key)?.value),
    customized: stored.has(b.key),
    updatedAt: stored.get(b.key)?.updatedAt ?? null,
  }));
}

export async function saveContent(key: string, value: unknown, userId: string) {
  const block = CONTENT_BLOCKS_BY_KEY.get(key);
  if (!block) throw HttpError.notFound("Unknown content block");
  const parsed = blockSchema(block).safeParse(value);
  if (!parsed.success) throw HttpError.badRequest("Validation failed", parsed.error.flatten());
  const { error } = await supabaseAdmin
    .from("page_content")
    .upsert({ key, value: parsed.data, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: "key" });
  if (error) throw HttpError.internal(error.message);
  cache = null;
  return parsed.data;
}

export async function resetContent(key: string) {
  if (!CONTENT_BLOCKS_BY_KEY.has(key)) throw HttpError.notFound("Unknown content block");
  const { error } = await supabaseAdmin.from("page_content").delete().eq("key", key);
  if (error) throw HttpError.internal(error.message);
  cache = null;
  return CONTENT_BLOCKS_BY_KEY.get(key)!.default;
}
