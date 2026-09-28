/**
 * Sets category images from a folder of files named by category slug (e.g. `teddy-bear.png`).
 * Each file goes through the same pipeline as an admin upload (re-encoded to webp, stored in
 * the public category-images bucket / CDN) and becomes the category's image_url.
 * Only categories still without a real image are touched, unless --force is passed.
 *
 *   npx tsx scripts/set-category-images.ts <folder> [--force] [--dry-run]
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../src/config/supabase.js";
import { BUCKETS, uploadProductImage } from "../src/modules/storage/upload.js";

const dir = process.argv[2];
const FORCE = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");
const isPlaceholder = (url?: string | null) => !url || /placeholder/i.test(url);

async function main() {
  if (!dir) throw new Error("Usage: npx tsx scripts/set-category-images.ts <folder> [--force] [--dry-run]");
  const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const { data: categories, error } = await supabaseAdmin.from("categories").select("id, name, slug, image_url");
  if (error) throw error;
  const bySlug = new Map((categories ?? []).map((c) => [c.slug, c]));

  for (const file of files) {
    const slug = path.parse(file).name;
    const c = bySlug.get(slug);
    if (!c) {
      console.warn(`skip  ${file} (no category with slug "${slug}")`);
      continue;
    }
    if (!FORCE && !isPlaceholder(c.image_url)) {
      console.log(`keep  ${c.name} (already has an image)`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`would ${c.name} <- ${file}`);
      continue;
    }
    const { url } = await uploadProductImage(BUCKETS.categoryImages, "generated", await readFile(path.join(dir, file)), 1000);
    const { error: updErr } = await supabaseAdmin.from("categories").update({ image_url: url }).eq("id", c.id);
    if (updErr) throw updErr;
    console.log(`ok    ${c.name} -> ${url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
