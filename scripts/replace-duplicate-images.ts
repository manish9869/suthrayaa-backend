/**
 * Replaces product/category photos that were shared across many items with the new studio
 * shots of real Suthrayaa pieces in ../generated-images. Only the row holding the shared
 * photo is swapped; any other photos a product has are kept. A JSON backup of every row it
 * touches is written first so the change can be rolled back.
 *
 *   npx tsx scripts/replace-duplicate-images.ts [--dry-run]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../src/config/supabase.js";
import { BUCKETS, uploadProductImage } from "../src/modules/storage/upload.js";

const DRY_RUN = process.argv.includes("--dry-run");
const IMAGES_DIR = path.resolve("../generated-images");

const TORAN_SHARED = "7d30bb6f-f18f-4d99-bc11-eed6de0d77b1";
const FLOWER_SHARED = "c1aa0c36-4a36-4f3b-acfa-48c9edba29a8";

/** Product name → [new image file, id fragment of the shared photo it replaces ("*" = all photos)]. */
const PRODUCTS: Record<string, [string, string]> = {
  "Crochet Door Hanging": ["08-shri-swami-samarth-toran.webp", TORAN_SHARED],
  "Crochet Flower Toran": ["09-red-rose-bell-toran.webp", TORAN_SHARED],
  "Traditional Marigold Toran": ["10-marigold-triangle-toran.webp", TORAN_SHARED],
  "Crochet Table Décor Piece": ["06-red-white-doily-toran-set.webp", TORAN_SHARED],
  "Crochet Home Accent": ["16-green-orange-pearl-toran.webp", TORAN_SHARED],
  "Mixed Crochet Flower Stems": ["18-hibiscus-lily-sonchafa-flowers.webp", FLOWER_SHARED],
  // Shared both photos with Classic Crochet Sunflower — gets its own pot shot instead.
  "Sunflower Pot Arrangement": ["05-sunflower-pot-and-smiley-flower.webp", "*"],
};

/** Category name → new image file (only categories that showed the shared toran photo). */
const CATEGORIES: Record<string, string> = {
  "Floral Door Hanging": "11-fan-toran-red-yellow-white.webp",
  "Door Décor": "12-fan-toran-blue-pink.webp",
  "Crochet Toran": "13-fan-toran-green-white-spiral.webp",
  "Traditional Toran": "14-fan-toran-maroon-yellow.webp",
  "Home Décor": "15-fan-toran-red-white-shell.webp",
  "Name Door Décor": "08-shri-swami-samarth-toran.webp",
  "Table Décor": "07-yellow-thali-mats-and-rangoli-border.webp",
};

const uploaded = new Map<string, string>();
async function upload(bucket: string, file: string, maxWidth: number) {
  const key = `${bucket}:${file}`;
  if (!uploaded.has(key)) {
    const { url } = await uploadProductImage(bucket, "studio", await readFile(path.join(IMAGES_DIR, file)), maxWidth);
    uploaded.set(key, url);
  }
  return uploaded.get(key)!;
}

async function main() {
  const { data: products, error } = await supabaseAdmin
    .from("products")
    .select("id, name, product_images(id, url, alt_text, sort_order, is_primary)")
    .in("name", Object.keys(PRODUCTS));
  if (error) throw error;
  const { data: categories, error: catErr } = await supabaseAdmin
    .from("categories")
    .select("id, name, image_url")
    .in("name", Object.keys(CATEGORIES));
  if (catErr) throw catErr;

  const backup = path.resolve(`../generated-images/backup-${Date.now()}.json`);
  await writeFile(backup, JSON.stringify({ products, categories }, null, 2));
  console.log(`${DRY_RUN ? "[dry run] " : ""}Backup of current rows: ${backup}`);

  for (const [name, [file, shared]] of Object.entries(PRODUCTS)) {
    const p = products?.find((x) => x.name === name);
    if (!p) {
      console.warn(`skip  product "${name}" (not found)`);
      continue;
    }
    const rows = p.product_images as { id: string; url: string }[];
    const targets = shared === "*" ? rows : rows.filter((r) => r.url.includes(shared));
    if (targets.length === 0) {
      console.log(`keep  ${name} (no shared photo left)`);
      continue;
    }
    console.log(`${DRY_RUN ? "would" : "ok   "} ${name} <- ${file} (${targets.length} row${targets.length > 1 ? "s" : ""})`);
    if (DRY_RUN) continue;
    const url = await upload(BUCKETS.productImages, file, 1200);
    if (shared === "*") {
      await supabaseAdmin.from("product_images").delete().in("id", rows.map((r) => r.id));
      const { error: insErr } = await supabaseAdmin
        .from("product_images")
        .insert({ product_id: p.id, url, alt_text: name, sort_order: 0, is_primary: true });
      if (insErr) throw insErr;
    } else {
      const { error: updErr } = await supabaseAdmin.from("product_images").update({ url }).in("id", targets.map((r) => r.id));
      if (updErr) throw updErr;
    }
  }

  for (const [name, file] of Object.entries(CATEGORIES)) {
    const c = categories?.find((x) => x.name === name);
    if (!c) {
      console.warn(`skip  category "${name}" (not found)`);
      continue;
    }
    console.log(`${DRY_RUN ? "would" : "ok   "} category ${name} <- ${file}`);
    if (DRY_RUN) continue;
    const url = await upload(BUCKETS.categoryImages, file, 1000);
    const { error: updErr } = await supabaseAdmin.from("categories").update({ image_url: url }).eq("id", c.id);
    if (updErr) throw updErr;
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
