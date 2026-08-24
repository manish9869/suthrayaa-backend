/**
 * Rebuilds the full 3-level category taxonomy (Category > Subcategory > Sub-subcategory).
 * Upserts by slug, so it's safe to re-run any time — including recovery after the
 * categories table gets truncated, without needing the Supabase SQL editor.
 */
import { supabaseAdmin } from "../src/config/supabase.js";

const LEVEL1 = [
  { slug: "flowers-floral", name: "Flowers & Floral", sort_order: 1 },
  { slug: "home-and-decor", name: "Home & Décor", sort_order: 2 },
  { slug: "accessories-v2", name: "Accessories", sort_order: 3 },
  { slug: "devghar-collection-v2", name: "Devghar Collection", sort_order: 4 },
  { slug: "kids-gifts", name: "Kids & Gifts", sort_order: 5 },
  { slug: "custom-special", name: "Custom & Special", sort_order: 6 },
];

const LEVEL2 = [
  { slug: "crochet-flowers-v2", name: "Crochet Flowers", parent: "flowers-floral", sort_order: 1 },
  { slug: "flower-pots-v2", name: "Flower Pots", parent: "flowers-floral", sort_order: 2 },
  { slug: "door-decor-v2", name: "Door Décor", parent: "home-and-decor", sort_order: 1 },
  { slug: "coasters-v2", name: "Coasters", parent: "home-and-decor", sort_order: 2 },
  { slug: "home-decor-v2", name: "Home Décor", parent: "home-and-decor", sort_order: 3 },
  { slug: "keychains-v2", name: "Keychains", parent: "accessories-v2", sort_order: 1 },
  { slug: "hair-accessories", name: "Hair Accessories", parent: "accessories-v2", sort_order: 2 },
  { slug: "bags-holders-v2", name: "Bags & Holders", parent: "accessories-v2", sort_order: 3 },
  { slug: "crochet-haar-garlands-v2", name: "Crochet Haar / Garlands", parent: "devghar-collection-v2", sort_order: 1 },
  { slug: "devghar-decor", name: "Devghar Décor", parent: "devghar-collection-v2", sort_order: 2 },
  { slug: "amigurumi-toys-v2", name: "Amigurumi Toys", parent: "kids-gifts", sort_order: 1 },
  { slug: "baby-collection-v2", name: "Baby Collection", parent: "kids-gifts", sort_order: 2 },
  { slug: "custom-orders-v2", name: "Custom Orders", parent: "custom-special", sort_order: 1 },
];

const PLANNED = "Planned — not yet in production";
const LEVEL3 = [
  { slug: "sunflowers-v2", name: "Sunflowers", parent: "crochet-flowers-v2", sort_order: 1 },
  { slug: "lilies-v2", name: "Lilies", parent: "crochet-flowers-v2", sort_order: 2 },
  { slug: "hibiscus-v2", name: "Hibiscus", parent: "crochet-flowers-v2", sort_order: 3 },
  { slug: "roses", name: "Roses", parent: "crochet-flowers-v2", sort_order: 4, description: PLANNED },
  { slug: "tulips", name: "Tulips", parent: "crochet-flowers-v2", sort_order: 5, description: PLANNED },
  { slug: "sunflower-pot", name: "Sunflower Pot", parent: "flower-pots-v2", sort_order: 1 },
  { slug: "mixed-flower-pot", name: "Mixed Flower Pot", parent: "flower-pots-v2", sort_order: 2, description: PLANNED },
  { slug: "floral-door-hanging", name: "Floral Door Hanging", parent: "door-decor-v2", sort_order: 1 },
  { slug: "traditional-toran", name: "Traditional Toran", parent: "door-decor-v2", sort_order: 2, description: PLANNED },
  { slug: "name-door-decor", name: "Name Door Décor", parent: "door-decor-v2", sort_order: 3, description: PLANNED },
  { slug: "flower-coasters", name: "Flower Coasters", parent: "coasters-v2", sort_order: 1 },
  { slug: "sunflower-coasters", name: "Sunflower Coasters", parent: "coasters-v2", sort_order: 2, description: PLANNED },
  { slug: "coaster-sets", name: "Coaster Sets", parent: "coasters-v2", sort_order: 3 },
  { slug: "wall-hangings", name: "Wall Hangings", parent: "home-decor-v2", sort_order: 1, description: PLANNED },
  { slug: "table-decor", name: "Table Décor", parent: "home-decor-v2", sort_order: 2, description: PLANNED },
  { slug: "flower-keychains", name: "Flower Keychains", parent: "keychains-v2", sort_order: 1 },
  { slug: "initial-keychains", name: "Initial Keychains", parent: "keychains-v2", sort_order: 2, description: PLANNED },
  { slug: "mini-crochet-keychains", name: "Mini Crochet Keychains", parent: "keychains-v2", sort_order: 3, description: PLANNED },
  { slug: "hair-ties-v2", name: "Hair Ties", parent: "hair-accessories", sort_order: 1 },
  { slug: "hairbands-v2", name: "Hairbands", parent: "hair-accessories", sort_order: 2 },
  { slug: "crochet-clips", name: "Crochet Clips", parent: "hair-accessories", sort_order: 3, description: PLANNED },
  { slug: "convertible-bottle-holders-v2", name: "Convertible Bottle Holders", parent: "bags-holders-v2", sort_order: 1 },
  { slug: "bottle-bags", name: "Bottle Bags", parent: "bags-holders-v2", sort_order: 2, description: PLANNED },
  { slug: "mini-sling-bags", name: "Mini Sling Bags", parent: "bags-holders-v2", sort_order: 3, description: PLANNED },
  { slug: "sonchafa-haar", name: "Sonchafa Haar", parent: "crochet-haar-garlands-v2", sort_order: 1 },
  { slug: "sonchafa-jaswand-haar", name: "Sonchafa & Jaswand Haar", parent: "crochet-haar-garlands-v2", sort_order: 2 },
  { slug: "jaswand-haar", name: "Jaswand Haar", parent: "crochet-haar-garlands-v2", sort_order: 3, description: PLANNED },
  { slug: "mixed-flower-haar", name: "Mixed Flower Haar", parent: "crochet-haar-garlands-v2", sort_order: 4, description: PLANNED },
  { slug: "crochet-toran", name: "Crochet Toran", parent: "devghar-decor", sort_order: 1, description: PLANNED },
  { slug: "pooja-flower-set", name: "Pooja Flower Set", parent: "devghar-decor", sort_order: 2, description: PLANNED },
  { slug: "decorative-mala", name: "Decorative Mala", parent: "devghar-decor", sort_order: 3, description: PLANNED },
  { slug: "teddy-bear", name: "Teddy Bear", parent: "amigurumi-toys-v2", sort_order: 1, description: PLANNED },
  { slug: "bunny", name: "Bunny", parent: "amigurumi-toys-v2", sort_order: 2, description: PLANNED },
  { slug: "bee", name: "Bee", parent: "amigurumi-toys-v2", sort_order: 3, description: PLANNED },
  { slug: "baby-booties", name: "Baby Booties", parent: "baby-collection-v2", sort_order: 1, description: PLANNED },
  { slug: "baby-rattle", name: "Baby Rattle", parent: "baby-collection-v2", sort_order: 2, description: PLANNED },
  { slug: "baby-gift-set", name: "Baby Gift Set", parent: "baby-collection-v2", sort_order: 3, description: PLANNED },
  { slug: "personalized-gifts", name: "Personalized Gifts", parent: "custom-orders-v2", sort_order: 1, description: PLANNED },
  { slug: "made-to-order-products", name: "Made-to-Order Products", parent: "custom-orders-v2", sort_order: 2, description: PLANNED },
];

async function main() {
  const idBySlug = new Map<string, string>();

  for (const c of LEVEL1) {
    const { data, error } = await supabaseAdmin
      .from("categories")
      .upsert({ slug: c.slug, name: c.name, sort_order: c.sort_order, is_active: true, parent_id: null }, { onConflict: "slug" })
      .select("id, slug")
      .single();
    if (error) throw new Error(`L1 ${c.slug}: ${error.message}`);
    idBySlug.set(data.slug, data.id);
  }
  console.log(`Upserted ${LEVEL1.length} top-level categories`);

  for (const c of LEVEL2) {
    const parentId = idBySlug.get(c.parent);
    if (!parentId) throw new Error(`L2 ${c.slug}: parent "${c.parent}" not found`);
    const { data, error } = await supabaseAdmin
      .from("categories")
      .upsert({ slug: c.slug, name: c.name, parent_id: parentId, sort_order: c.sort_order, is_active: true }, { onConflict: "slug" })
      .select("id, slug")
      .single();
    if (error) throw new Error(`L2 ${c.slug}: ${error.message}`);
    idBySlug.set(data.slug, data.id);
  }
  console.log(`Upserted ${LEVEL2.length} subcategories`);

  for (const c of LEVEL3) {
    const parentId = idBySlug.get(c.parent);
    if (!parentId) throw new Error(`L3 ${c.slug}: parent "${c.parent}" not found`);
    const { error } = await supabaseAdmin.from("categories").upsert(
      {
        slug: c.slug,
        name: c.name,
        description: c.description ?? null,
        parent_id: parentId,
        sort_order: c.sort_order,
        is_active: true,
      },
      { onConflict: "slug" }
    );
    if (error) throw new Error(`L3 ${c.slug}: ${error.message}`);
  }
  console.log(`Upserted ${LEVEL3.length} sub-subcategories`);
  console.log("Category taxonomy is up to date.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
