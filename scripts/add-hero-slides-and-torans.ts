/**
 * Adds the new homepage hero slides (built from the studio shots of real Suthrayaa pieces)
 * after the existing ones, and creates each toran design that had no product of its own as a
 * separate product. Existing slides and products are left untouched; re-running skips any
 * slide title / product SKU that already exists.
 *
 *   npx tsx scripts/add-hero-slides-and-torans.ts [--dry-run]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "../src/config/supabase.js";
import { BUCKETS, uploadProductImage } from "../src/modules/storage/upload.js";

const DRY_RUN = process.argv.includes("--dry-run");
const IMAGES_DIR = path.resolve("../generated-images");

const SLIDES = [
  {
    file: "hero/hero-1-swami-samarth-doorway.webp",
    title: "Blessings at every doorway. Stitched in your words.",
    subtitle: "Name & devotional torans",
    description: "Crochet torans carrying a family name or a favourite prayer — hooked letter by letter, finished with pearls and pom-poms.",
    cta_label: "Shop torans",
    cta_href: "/shop?search=toran",
  },
  {
    file: "hero/hero-2-forever-flowers.webp",
    title: "A garden that never fades. Bloom by bloom.",
    subtitle: "Crochet flowers & pots",
    description: "Sunflower pots, hibiscus and lily stems and little bud keychains — bright colour for every shelf, no watering needed.",
    cta_label: "Shop flowers",
    cta_href: "/shop?category=flowers-floral",
  },
  {
    file: "hero/hero-3-fan-toran.webp",
    title: "Festive fans for your front door. Made to be noticed.",
    subtitle: "Fan torans",
    description: "Layered crochet fan torans with flower chains, ruffled edges and pom-pom tassels — in every festive colour.",
    cta_label: "Shop fan torans",
    cta_href: "/shop?category=crochet-toran",
  },
  {
    file: "hero/hero-4-pooja-table.webp",
    title: "Set the thali. Light the diya.",
    subtitle: "Pooja table décor",
    description: "Crochet thali mats, rangoli borders and doilies that make every puja and festive table feel special.",
    cta_label: "Shop table décor",
    cta_href: "/shop?category=table-decor",
  },
  {
    file: "hero/hero-5-marigold-toran.webp",
    title: "Marigold mornings. All year round.",
    subtitle: "Traditional torans",
    description: "Bright marigold crochet torans with twisted strings and pom-pom flowers that never wilt.",
    cta_label: "Shop traditional torans",
    cta_href: "/shop?category=traditional-toran",
  },
];

const TORAN_DEFAULTS = {
  category: "crochet-toran",
  price: 999,
  stock: 10,
  materials: ["Acrylic Yarn", "Pom-pom Tassels"],
  care: ["Dust gently", "Spot clean with a damp cloth", "Keep away from moisture"],
};

const TORANS = [
  {
    sku: "CR-TORAN-FAN-RYW",
    name: "Red & Yellow Fan Toran",
    file: "11-fan-toran-red-yellow-white.webp",
    short: "White fan toran with red diamond band and yellow ruffles",
    description:
      "A handmade crochet toran with a white band of red diamonds, two white fans with red-and-yellow centres, red flower chains, layered yellow ruffles and red pom-pom tassels.",
  },
  {
    sku: "CR-TORAN-FAN-BPK",
    name: "Blue & Pink Fan Toran",
    file: "12-fan-toran-blue-pink.webp",
    short: "Royal blue fan toran with pink crochet flowers",
    description:
      "A handmade crochet toran with a royal blue shell-stitch band, two white fans with blue-and-pink centres, rows of pink crochet flowers, blue ruffles and pink pom-pom tassels.",
  },
  {
    sku: "CR-TORAN-FAN-GWS",
    name: "Green & White Spiral Fan Toran",
    file: "13-fan-toran-green-white-spiral.webp",
    short: "Green toran with white spiral fans and red roses",
    description:
      "A handmade crochet toran with a green lattice band, two fans of white spiral curls around red crochet roses, ruffled green-and-white edges and pom-pom tassels.",
  },
  {
    sku: "CR-TORAN-FAN-MYL",
    name: "Maroon & Yellow Fan Toran",
    file: "14-fan-toran-maroon-yellow.webp",
    short: "White fan toran with maroon flowers and yellow ruffles",
    description:
      "A handmade crochet toran with a braided red-and-yellow band, two white fans with maroon-and-yellow centres, maroon flower chains, yellow ruffles and maroon pom-pom tassels.",
  },
  {
    sku: "CR-TORAN-FAN-RSH",
    name: "Red Shell Fan Toran",
    file: "15-fan-toran-red-white-shell.webp",
    short: "Red shell-stitch toran with white fans and zigzag ruffles",
    description:
      "A handmade crochet toran with a red band of white shell stitches, two white fans with red-and-yellow centres, red flower chains, yellow zigzag ruffles and red-and-white pom-poms.",
  },
  {
    sku: "CR-TORAN-PEACOCK",
    name: "Peacock Feather Toran",
    file: "17-peacock-toran-original-photo.webp",
    short: "Green toran with eight crochet peacock feathers",
    description:
      "A handmade crochet toran with a bright green band of blue-and-orange flowers and eight peacock-feather motifs, each finished with a crystal bead and an orange wooden bead.",
    price: 899,
  },
];

const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function addSlides() {
  const { data: existing, error } = await supabaseAdmin.from("hero_slides").select("title, sort_order");
  if (error) throw error;
  let order = Math.max(0, ...(existing ?? []).map((s) => s.sort_order)) + 1;
  for (const s of SLIDES) {
    if (existing?.some((e) => e.title === s.title)) {
      console.log(`keep  slide "${s.title}" (already exists)`);
      continue;
    }
    console.log(`${DRY_RUN ? "would" : "ok   "} slide #${order} "${s.title}"`);
    if (DRY_RUN) {
      order++;
      continue;
    }
    const { url } = await uploadProductImage(BUCKETS.heroMedia, "slides", await readFile(path.join(IMAGES_DIR, s.file)), 2000);
    const { file: _file, ...fields } = s;
    const { error: insErr } = await supabaseAdmin.from("hero_slides").insert({ ...fields, image_url: url, sort_order: order++, is_active: true });
    if (insErr) throw insErr;
  }
}

async function addTorans() {
  const { data: category, error } = await supabaseAdmin.from("categories").select("id").eq("slug", TORAN_DEFAULTS.category).single();
  if (error) throw error;
  const { data: existing } = await supabaseAdmin.from("products").select("sku").in("sku", TORANS.map((t) => t.sku));
  for (const t of TORANS) {
    if (existing?.some((e) => e.sku === t.sku)) {
      console.log(`keep  product ${t.name} (already exists)`);
      continue;
    }
    console.log(`${DRY_RUN ? "would" : "ok   "} product ${t.name} ₹${t.price ?? TORAN_DEFAULTS.price} <- ${t.file}`);
    if (DRY_RUN) continue;
    const { url } = await uploadProductImage(BUCKETS.productImages, "studio", await readFile(path.join(IMAGES_DIR, t.file)), 1200);
    const { data: product, error: insErr } = await supabaseAdmin
      .from("products")
      .insert({
        sku: t.sku,
        name: t.name,
        slug: slugify(t.name),
        description: t.description,
        short_description: t.short,
        price: t.price ?? TORAN_DEFAULTS.price,
        category_id: category.id,
        tags: ["toran", "door decor", "festive", "handmade"],
        stock: TORAN_DEFAULTS.stock,
        new_arrival: true,
        estimated_delivery: "7-10 business days",
        materials: TORAN_DEFAULTS.materials,
        care_instructions: TORAN_DEFAULTS.care,
        customizable: false,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    await supabaseAdmin.from("customization_rules").insert({ product_id: product.id });
    const { error: imgErr } = await supabaseAdmin
      .from("product_images")
      .insert({ product_id: product.id, url, alt_text: t.name, sort_order: 0, is_primary: true });
    if (imgErr) throw imgErr;
  }
}

async function main() {
  console.log(`${DRY_RUN ? "[dry run] " : ""}Hero slides:`);
  await addSlides();
  console.log("Torans:");
  await addTorans();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
