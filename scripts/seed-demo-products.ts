/**
 * Demo-launch catalogue filler: one sample product in every active sub-category that has no
 * products yet, using that category's image. Every row is tagged — SKU "DEMO-…" and the
 * "demo" tag — so it can be removed in one go before real stock goes up.
 *
 *   npm run seed:demo-products              # add (skips categories that already have products)
 *   npm run seed:demo-products -- --remove  # delete every DEMO- product
 */
import { supabaseAdmin } from "../src/config/supabase.js";

const REMOVE = process.argv.includes("--remove");

/** Per-slug name + price; anything not listed falls back to "Handmade Crochet <Category>". */
const DEMO: Record<string, [name: string, price: number, blurb: string]> = {
  "amigurumi-toys-v2": ["Amigurumi Friends Trio", 899, "Three pocket-sized crochet pals — a bunny, a bear and an octopus."],
  "teddy-bear": ["Honey Crochet Teddy", 749, "A soft, huggable teddy with a little red bow, stitched by hand."],
  bunny: ["Floppy-Ear Crochet Bunny", 649, "A cuddly bunny with long floppy ears in cream and blush pink."],
  bee: ["Buzzy Crochet Bee", 399, "A cheerful little bumblebee — a sweet desk buddy or gift."],
  "baby-booties": ["Newborn Crochet Booties", 549, "Soft cotton booties with tiny flower buttons, gentle on little feet."],
  "baby-rattle": ["Star Crochet Rattle", 449, "A smiling star rattle on a natural wooden ring."],
  "baby-collection-v2": ["Baby Welcome Bundle", 1499, "Booties, a rattle, a mini blanket and a bunny — a complete welcome set."],
  "baby-gift-set": ["Baby Gift Box", 1199, "Booties, rattle and bib, gift-boxed with a ribbon."],
  tulips: ["Crochet Tulip Bouquet", 699, "Everlasting tulips in red, pink and yellow."],
  "wall-hangings": ["Blossom Wall Hanging", 999, "Crochet flowers and tassels on a wooden dowel."],
  "hair-accessories": ["Flower Hair Accessory Set", 499, "Scrunchies, a hairband and clips with crochet blooms."],
  "personalized-gifts": ["Personalised Flower Keychain", 349, "A crochet flower keychain with a tag for a name or initial."],
  "custom-orders-v2": ["Custom Crochet Piece", 999, "Tell us your idea — colours, size and style made to order."],
  "made-to-order-products": ["Made-to-Order Crochet Set", 1299, "A bespoke set crafted to your chosen colours."],
  roses: ["Crochet Rose Stem", 249, "A single everlasting rose, stem and leaves included."],
  "crochet-clips": ["Flower Crochet Clips (Pair)", 199, "A pair of hair clips topped with crochet flowers."],
  "initial-keychains": ["Initial Crochet Keychain", 229, "Your initial, crocheted into a keychain."],
  "mini-crochet-keychains": ["Mini Crochet Keychain", 179, "Tiny, colourful crochet charms for keys or bags."],
  "mini-sling-bags": ["Mini Crochet Sling Bag", 849, "A phone-sized crochet sling with an adjustable strap."],
  "bottle-bags": ["Crochet Bottle Bag", 399, "A mesh crochet carrier for your water bottle."],
  "sunflower-coasters": ["Sunflower Coaster Set", 499, "Four sunflower coasters to brighten any table."],
  "table-decor": ["Crochet Table Décor Piece", 599, "A handmade accent to dress up your table."],
  "pooja-flower-set": ["Pooja Flower Set", 699, "Crochet flowers for your pooja thali — reusable and bright."],
  "decorative-mala": ["Decorative Crochet Mala", 549, "A flower mala for doors, frames or your devghar."],
  "jaswand-haar": ["Jaswand Haar", 599, "A garland of red crochet hibiscus (jaswand) flowers."],
  "mixed-flower-haar": ["Mixed Flower Haar", 649, "A colourful garland of assorted crochet flowers."],
  "crochet-toran": ["Crochet Flower Toran", 899, "A festive crochet toran with flowers and tassels."],
  "traditional-toran": ["Traditional Marigold Toran", 949, "Marigolds and mango leaves in everlasting crochet."],
  "name-door-decor": ["Name Door Wreath", 799, "A floral crochet wreath with space for your family name."],
  "crochet-flowers-v2": ["Mixed Crochet Flower Stems", 599, "A handful of everlasting crochet blooms for any vase."],
  "home-decor-v2": ["Crochet Home Accent", 649, "A handmade crochet accent that warms up any corner."],
  "bags-holders-v2": ["Crochet Tote Bag", 999, "A sturdy handmade crochet tote for everyday carry."],
  "crochet-haar-garlands-v2": ["Marigold Crochet Garland", 699, "Bright marigolds that never wilt — for doors and festivals."],
  "mixed-flower-pot": ["Mixed Flower Crochet Pot", 749, "Assorted crochet flowers in a little pot."],
  "flower-pots-v2": ["Potted Crochet Blooms", 649, "Everlasting crochet flowers, potted and ready to display."],
  "coasters-v2": ["Crochet Coaster Set", 449, "A set of four handmade crochet coasters."],
  "keychains-v2": ["Crochet Flower Keychain", 249, "A bright crochet flower for your keys or bag."],
  "devghar-decor": ["Devghar Crochet Garland", 599, "A crochet flower garland to decorate your devghar."],
  "door-decor-v2": ["Crochet Door Hanging", 799, "A handmade crochet hanging to welcome guests."],
};

async function remove() {
  const { data, error } = await supabaseAdmin.from("products").select("id, name").like("sku", "DEMO-%");
  if (error) throw error;
  if (!data?.length) return console.log("No demo products found.");
  const ids = data.map((p) => p.id);
  await supabaseAdmin.from("product_images").delete().in("product_id", ids);
  await supabaseAdmin.from("product_categories").delete().in("product_id", ids);
  const { error: delErr } = await supabaseAdmin.from("products").delete().in("id", ids);
  if (delErr) throw delErr;
  console.log(`Removed ${ids.length} demo products.`);
}

async function seed() {
  const [{ data: cats, error }, { data: prods }, { data: links }] = await Promise.all([
    supabaseAdmin.from("categories").select("id, name, slug, parent_id, image_url").eq("is_active", true),
    supabaseAdmin.from("products").select("category_id"),
    supabaseAdmin.from("product_categories").select("category_id"),
  ]);
  if (error) throw error;
  const used = new Set([...(prods ?? []).map((p) => p.category_id), ...(links ?? []).map((l) => l.category_id)]);
  const targets = (cats ?? []).filter((c) => c.parent_id && !used.has(c.id));

  for (const c of targets) {
    const [name, price, blurb] = DEMO[c.slug] ?? [`Handmade Crochet ${c.name}`, 499, `A handmade crochet piece from our ${c.name} collection.`];
    const sku = `DEMO-${c.slug.toUpperCase()}`;
    const { data: product, error: insErr } = await supabaseAdmin
      .from("products")
      .insert({
        slug: `demo-${c.slug}`,
        sku,
        name,
        description: `${blurb} Handmade to order in soft cotton yarn by Suthrayaa artisans.`,
        short_description: blurb,
        price,
        category_id: c.id,
        tags: ["demo", c.name.toLowerCase()],
        stock: 10,
        low_stock_threshold: 3,
        new_arrival: true,
        is_active: true,
        status: "active",
        product_type: "ready_to_ship",
        estimated_delivery: "7-10 business days",
        materials: ["Cotton Yarn"],
        care_instructions: ["Spot clean gently", "Keep dry"],
        track_inventory: true,
        is_physical: true,
        is_taxable: true,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`${c.name}: ${insErr.message}`);
    await supabaseAdmin.from("product_categories").insert({ product_id: product.id, category_id: c.id, is_primary: true });
    if (c.image_url) {
      await supabaseAdmin.from("product_images").insert({ product_id: product.id, url: c.image_url, alt_text: name, sort_order: 0, is_primary: true });
    }
    console.log(`+ ${name} (₹${price}) in ${c.name}`);
  }
  console.log(`\nAdded ${targets.length} demo products. Remove them later with: npm run seed:demo-products -- --remove`);
}

(REMOVE ? remove() : seed()).catch((err) => {
  console.error(err);
  process.exit(1);
});
