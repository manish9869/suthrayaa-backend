/**
 * Gives every product and category that still shows `/placeholder.svg` (or has no image)
 * the matching studio shot of the real Suthrayaa piece, chosen by name — the same rules
 * the storefront uses as its display fallback (suthrayaa/lib/studio-images.ts).
 *
 * The studio shots live in the storefront at /editorial/scene-*.webp. This script fetches
 * them from a running storefront, re-encodes and uploads them to the product/category
 * image buckets (same pipeline as an admin upload), and writes the image rows. Anything
 * with a real uploaded photo is left untouched, so it is safe to re-run.
 *
 *   STOREFRONT_URL=https://suthrayaa.com pnpm attach:studio-images            # apply
 *   STOREFRONT_URL=https://suthrayaa.com pnpm attach:studio-images --dry-run  # preview
 */
import { supabaseAdmin } from "../src/config/supabase.js";
import { BUCKETS, uploadProductImage } from "../src/modules/storage/upload.js";

const STOREFRONT_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DRY_RUN = process.argv.includes("--dry-run");

const S = (name: string) => `/editorial/scene-${name}.webp`;

/** First match wins — keep in sync with suthrayaa/lib/studio-images.ts. */
const RULES: [RegExp, string[]][] = [
  [/sonchafa\s*(&|and)\s*jaswand|jaswand/i, [S("garland"), S("devghar")]],
  [/sonchafa/i, [S("sonchafa"), S("garland")]],
  [/sunflower\s*pot|potted/i, [S("sunflowers"), S("flatlay")]],
  [/sunflower/i, [S("sunflowers"), S("flatlay")]],
  [/lily|lilies/i, [S("lily")]],
  [/hibiscus/i, [S("hibiscus"), S("bouquet"), S("bouquet-pink")]],
  [/bouquet/i, [S("bouquet"), S("bouquet-pink"), S("hibiscus")]],
  [/door\s*hanging|toran/i, [S("rosetoran"), S("rosetoran-marigold"), S("fantoran"), S("toran")]],
  [/flower\s*coaster/i, [S("coasters"), S("coasters-pastel"), S("doily")]],
  [/coaster|mat\b|mats\b/i, [S("mats"), S("coasters")]],
  [/doily/i, [S("doily")]],
  [/keychain|key\s*chain|charm/i, [S("flowerkeys"), S("keychains")]],
  [/hair\s*tie|scrunchie/i, [S("hair"), S("gajra")]],
  [/hair\s*band|headband/i, [S("hairband"), S("hairband-pastel")]],
  [/clip/i, [S("hairband"), S("hair")]],
  [/gajra|veni|mogra|jasmine/i, [S("gajra"), S("hair")]],
  [/bottle/i, [S("bottleopen"), S("bottleopen-lilac"), S("staropen")]],
  [/tote|shoulder\s*bag|granny/i, [S("totes"), S("bags")]],
  [/sling|bag|pouch/i, [S("bags"), S("totes")]],
  [/mobile|moon/i, [S("mobile")]],
  [/star/i, [S("staropen"), S("bottleopen")]],
  [/garland|haar|mala/i, [S("garland"), S("devghar")]],
  [/devghar|pooja|puja|chowki/i, [S("devghar"), S("garland")]],
  [/flower|floral|rose/i, [S("bouquet"), S("hibiscus")]],
  [/decor|décor|home/i, [S("rosetoran"), S("doily")]],
];

/** Product name first, then category — a product's own name beats a broader category match. */
const imagesFor = (...names: (string | null | undefined)[]) => {
  for (const name of names) {
    if (!name) continue;
    const hit = RULES.find(([re]) => re.test(name));
    if (hit) return hit[1];
  }
  return [];
};
const isPlaceholder = (url?: string | null) => !url || /placeholder/i.test(url);

const uploaded = new Map<string, string>();
async function upload(bucket: string, folder: string, path: string): Promise<string> {
  const key = `${bucket}:${path}`;
  const cached = uploaded.get(key);
  if (cached) return cached;
  const res = await fetch(`${STOREFRONT_URL}${path}`);
  if (!res.ok) throw new Error(`Could not fetch ${STOREFRONT_URL}${path} (${res.status})`);
  const { url } = await uploadProductImage(bucket, folder, Buffer.from(await res.arrayBuffer()));
  uploaded.set(key, url);
  return url;
}

async function attachProducts() {
  const { data: products, error } = await supabaseAdmin
    .from("products")
    .select("id, name, categories(name, slug), product_images(id, url)");
  if (error) throw error;

  for (const p of products ?? []) {
    const rows = (p.product_images ?? []) as { id: string; url: string }[];
    if (rows.some((r) => !isPlaceholder(r.url))) continue; // has a real photo
    const category = p.categories as unknown as { name?: string; slug?: string } | null;
    const studio = imagesFor(p.name, category?.name, category?.slug);
    if (studio.length === 0) {
      console.log(`  - ${p.name}: no matching studio shot, skipped`);
      continue;
    }
    console.log(`  + ${p.name}: ${studio.join(", ")}`);
    if (DRY_RUN) continue;

    const urls = [];
    for (const path of studio) urls.push(await upload(BUCKETS.productImages, "studio", path));
    if (rows.length) await supabaseAdmin.from("product_images").delete().in("id", rows.map((r) => r.id));
    const { error: insErr } = await supabaseAdmin.from("product_images").insert(
      urls.map((url, i) => ({ product_id: p.id, url, alt_text: p.name, sort_order: i, is_primary: i === 0 })),
    );
    if (insErr) throw insErr;
  }
}

async function attachCategories() {
  const { data: categories, error } = await supabaseAdmin.from("categories").select("id, name, slug, image_url");
  if (error) throw error;

  for (const c of categories ?? []) {
    if (!isPlaceholder(c.image_url)) continue;
    const [first] = imagesFor(c.name, c.slug);
    if (!first) continue;
    console.log(`  + category ${c.name}: ${first}`);
    if (DRY_RUN) continue;
    const url = await upload(BUCKETS.categoryImages, "studio", first);
    const { error: updErr } = await supabaseAdmin.from("categories").update({ image_url: url }).eq("id", c.id);
    if (updErr) throw updErr;
  }
}

async function main() {
  console.log(`${DRY_RUN ? "[dry run] " : ""}Attaching studio images from ${STOREFRONT_URL}`);
  console.log("Products:");
  await attachProducts();
  console.log("Categories:");
  await attachCategories();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
