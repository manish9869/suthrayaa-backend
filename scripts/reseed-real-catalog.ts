/**
 * Clears the placeholder demo catalog (products, orders, cart/wishlist, reviews) and
 * seeds real products across the actual (non-"dummy") leaf categories from the
 * confirmed taxonomy. One-time operational script, not part of the running server.
 */
import { supabaseAdmin } from "../src/config/supabase.js";

async function clearExistingData() {
  console.log("Clearing existing demo/test data...");
  // Children first, respecting FK order where cascade isn't already configured.
  await supabaseAdmin.from("order_status_history").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("coupon_redemptions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("order_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("orders").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("cart_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("wishlist_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("reviews").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("customization_values").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("product_customizations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("customization_allowed_colors").delete().neq("customization_rule_id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("customization_rules").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("product_images").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("product_colors").delete().neq("color_id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("products").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  console.log("Cleared.");
}

const COLORS: Record<string, string> = {
  "#FFD700": "Sunflower Yellow",
  "#FFFFFF": "White",
  "#FF69B4": "Hot Pink",
  "#FFB6C1": "Blush Pink",
  "#DC143C": "Hibiscus Red",
  "#D2B48C": "Tan",
  "#8B4513": "Brown",
  "#F5DEB3": "Wheat",
  "#FFA500": "Marigold Orange",
  "#9370DB": "Purple",
};

interface SeedProduct {
  sku: string;
  name: string;
  description: string;
  shortDescription: string;
  price: number;
  comparePrice?: number;
  categorySlug: string;
  tags: string[];
  colors: string[];
  featured?: boolean;
  bestseller?: boolean;
  newArrival?: boolean;
  stock: number;
  estimatedDelivery: string;
  materials: string[];
  careInstructions: string[];
  customizations?: {
    name: string;
    label: string;
    type: "choice" | "color" | "text" | "checkbox";
    required: boolean;
    values: { label: string; value: string; priceAdjustment?: number }[];
    revealTextGroup?: { name: string; label: string; placeholder: string; maxLength: number; onValueLabel: string };
  }[];
}

const PRODUCTS: SeedProduct[] = [
  {
    sku: "CR-FLOW-SUN-001",
    name: "Classic Crochet Sunflower",
    description:
      "A cheerful handcrafted sunflower, crocheted stitch by stitch with soft cotton yarn. Perfect on its own in a vase or as part of a bouquet.",
    shortDescription: "Handmade crochet sunflower stem",
    price: 249,
    categorySlug: "sunflowers-v2",
    tags: ["sunflower", "flower", "decor"],
    colors: ["#FFD700"],
    featured: true,
    bestseller: true,
    stock: 30,
    estimatedDelivery: "5-7 business days",
    materials: ["100% Cotton Yarn", "Floral Wire Stem"],
    careInstructions: ["Dust gently", "Keep away from direct sunlight"],
    customizations: [
      {
        name: "Size",
        label: "Choose Size",
        type: "choice",
        required: true,
        values: [
          { label: "Small", value: "small", priceAdjustment: 0 },
          { label: "Medium", value: "medium", priceAdjustment: 50 },
          { label: "Large", value: "large", priceAdjustment: 100 },
        ],
      },
    ],
  },
  {
    sku: "CR-FLOW-LIL-001",
    name: "Crochet Lily Stem",
    description: "An elegant crochet lily, hand-shaped petal by petal for a graceful, timeless look.",
    shortDescription: "Handmade crochet lily stem",
    price: 279,
    categorySlug: "lilies-v2",
    tags: ["lily", "flower", "decor"],
    colors: ["#FFFFFF", "#FF69B4"],
    newArrival: true,
    stock: 24,
    estimatedDelivery: "5-7 business days",
    materials: ["100% Cotton Yarn", "Floral Wire Stem"],
    careInstructions: ["Dust gently", "Keep away from direct sunlight"],
    customizations: [
      {
        name: "Color",
        label: "Choose Color",
        type: "color",
        required: true,
        values: [
          { label: "White", value: "#FFFFFF" },
          { label: "Hot Pink", value: "#FF69B4" },
        ],
      },
    ],
  },
  {
    sku: "CR-FLOW-HIB-001",
    name: "Crochet Hibiscus Stem",
    description: "A vibrant hibiscus bloom in soft yarn, capturing the flower's bold, open petals in careful detail.",
    shortDescription: "Handmade crochet hibiscus stem",
    price: 279,
    categorySlug: "hibiscus-v2",
    tags: ["hibiscus", "flower", "decor"],
    colors: ["#DC143C"],
    stock: 20,
    estimatedDelivery: "5-7 business days",
    materials: ["100% Cotton Yarn", "Floral Wire Stem"],
    careInstructions: ["Dust gently", "Keep away from direct sunlight"],
  },
  {
    sku: "CR-POT-SUN-001",
    name: "Sunflower Pot Arrangement",
    description:
      "A potted arrangement of handcrafted crochet sunflowers, ready to brighten any tabletop or shelf — no watering needed.",
    shortDescription: "Potted crochet sunflower arrangement",
    price: 599,
    comparePrice: 699,
    categorySlug: "sunflower-pot",
    tags: ["sunflower", "pot", "decor"],
    colors: ["#FFD700"],
    bestseller: true,
    stock: 15,
    estimatedDelivery: "7-10 business days",
    materials: ["Cotton Yarn", "Ceramic Pot", "Floral Foam"],
    careInstructions: ["Dust gently", "Wipe pot with a damp cloth"],
    customizations: [
      {
        name: "Flower Count",
        label: "Flower Count",
        type: "choice",
        required: true,
        values: [
          { label: "3 Stems", value: "3", priceAdjustment: 0 },
          { label: "5 Stems", value: "5", priceAdjustment: 150 },
        ],
      },
    ],
  },
  {
    sku: "CR-DOOR-FLR-001",
    name: "Floral Door Hanging",
    description:
      "A beautiful handmade crochet door hanging featuring a floral arrangement — a warm, handcrafted welcome for your home.",
    shortDescription: "Handmade floral crochet door décor",
    price: 449,
    categorySlug: "floral-door-hanging",
    tags: ["door decor", "floral", "home"],
    colors: ["#FFD700", "#FF69B4", "#FFFFFF"],
    featured: true,
    stock: 18,
    estimatedDelivery: "7-10 business days",
    materials: ["Cotton Yarn", "Wooden Ring", "Jute Accents"],
    careInstructions: ["Dust regularly", "Keep dry"],
    customizations: [
      {
        name: "Size",
        label: "Choose Size",
        type: "choice",
        required: true,
        values: [
          { label: "Small", value: "small", priceAdjustment: 0 },
          { label: "Medium", value: "medium", priceAdjustment: 100 },
          { label: "Large", value: "large", priceAdjustment: 200 },
        ],
      },
      {
        name: "FlowerColor",
        label: "Flower Color",
        type: "color",
        required: true,
        values: [
          { label: "Sunflower Yellow", value: "#FFD700" },
          { label: "Hot Pink", value: "#FF69B4" },
          { label: "White", value: "#FFFFFF" },
        ],
      },
      {
        name: "AddName",
        label: "Add Name?",
        type: "checkbox",
        required: false,
        values: [
          { label: "No", value: "no", priceAdjustment: 0 },
          { label: "Yes", value: "yes", priceAdjustment: 100 },
        ],
        revealTextGroup: { name: "Name", label: "Enter Name", placeholder: "e.g. Shree", maxLength: 20, onValueLabel: "Yes" },
      },
    ],
  },
  {
    sku: "CR-COAST-FLW-001",
    name: "Flower Coaster Set",
    description: "A set of handcrafted flower-shaped coasters — practical and pretty, protecting surfaces with a handmade touch.",
    shortDescription: "Set of handmade flower coasters",
    price: 349,
    categorySlug: "flower-coasters",
    tags: ["coaster", "flower", "home"],
    colors: ["#FFD700", "#FF69B4", "#9370DB"],
    stock: 40,
    estimatedDelivery: "5-7 business days",
    materials: ["Cotton Yarn", "Felt Backing"],
    careInstructions: ["Spot clean only", "Air dry"],
    customizations: [
      {
        name: "SetSize",
        label: "Set of",
        type: "choice",
        required: true,
        values: [
          { label: "2", value: "2", priceAdjustment: 0 },
          { label: "4", value: "4", priceAdjustment: 150 },
          { label: "6", value: "6", priceAdjustment: 280 },
        ],
      },
    ],
  },
  {
    sku: "CR-COAST-SET-001",
    name: "Classic Coaster Set",
    description: "Everyday crochet coasters in a versatile round design — durable cotton yarn that's easy to care for.",
    shortDescription: "Classic round crochet coaster set",
    price: 299,
    categorySlug: "coaster-sets",
    tags: ["coaster", "home", "set"],
    colors: ["#D2B48C", "#FFFFFF", "#8B4513"],
    stock: 45,
    estimatedDelivery: "5-7 business days",
    materials: ["Cotton Yarn"],
    careInstructions: ["Spot clean only", "Air dry"],
  },
  {
    sku: "CR-KEY-FLW-001",
    name: "Flower Keychain",
    description: "A dainty crochet flower keychain — a sweet handmade accessory for bags, keys, or gifting.",
    shortDescription: "Handmade crochet flower keychain",
    price: 149,
    categorySlug: "flower-keychains",
    tags: ["keychain", "flower", "gift"],
    colors: ["#FFD700", "#FF69B4", "#9370DB", "#FFFFFF"],
    bestseller: true,
    stock: 60,
    estimatedDelivery: "3-5 business days",
    materials: ["Cotton Yarn", "Metal Keyring"],
    careInstructions: ["Spot clean only", "Keep away from water"],
    customizations: [
      {
        name: "Color",
        label: "Choose Color",
        type: "color",
        required: true,
        values: [
          { label: "Sunflower Yellow", value: "#FFD700" },
          { label: "Hot Pink", value: "#FF69B4" },
          { label: "Purple", value: "#9370DB" },
          { label: "White", value: "#FFFFFF" },
        ],
      },
    ],
  },
  {
    sku: "CR-HAIR-TIE-001",
    name: "Crochet Flower Hair Tie",
    description: "A soft crochet flower hair tie that's gentle on hair and full of handmade charm.",
    shortDescription: "Handmade flower hair tie",
    price: 99,
    categorySlug: "hair-ties-v2",
    tags: ["hair tie", "flower", "accessory"],
    colors: ["#FFD700", "#FF69B4", "#FFB6C1"],
    stock: 80,
    estimatedDelivery: "3-5 business days",
    materials: ["Cotton Yarn", "Elastic Band"],
    careInstructions: ["Hand wash cold", "Air dry"],
    customizations: [
      {
        name: "FlowerStyle",
        label: "Flower Style",
        type: "choice",
        required: true,
        values: [
          { label: "Sunflower", value: "sunflower", priceAdjustment: 0 },
          { label: "Rosette", value: "rosette", priceAdjustment: 0 },
        ],
      },
    ],
  },
  {
    sku: "CR-HAIR-BND-001",
    name: "Crochet Hairband",
    description: "A comfortable, stretchy crochet hairband finished with a delicate handmade flower accent.",
    shortDescription: "Handmade crochet hairband",
    price: 179,
    categorySlug: "hairbands-v2",
    tags: ["hairband", "flower", "accessory"],
    colors: ["#FFB6C1", "#FFFFFF", "#9370DB"],
    stock: 50,
    estimatedDelivery: "3-5 business days",
    materials: ["Cotton Yarn", "Elastic Band"],
    careInstructions: ["Hand wash cold", "Air dry"],
    customizations: [
      {
        name: "Color",
        label: "Choose Color",
        type: "color",
        required: true,
        values: [
          { label: "Blush Pink", value: "#FFB6C1" },
          { label: "White", value: "#FFFFFF" },
          { label: "Purple", value: "#9370DB" },
        ],
      },
    ],
  },
  {
    sku: "CR-BAG-BTL-001",
    name: "Convertible Bottle Holder",
    description: "A clever crochet bottle holder that converts into a sling bag — handmade, functional, and uniquely yours.",
    shortDescription: "Handmade convertible bottle holder",
    price: 549,
    comparePrice: 649,
    categorySlug: "convertible-bottle-holders-v2",
    tags: ["bottle holder", "bag", "functional"],
    colors: ["#D2B48C", "#8B4513", "#F5DEB3"],
    newArrival: true,
    stock: 12,
    estimatedDelivery: "7-10 business days",
    materials: ["Cotton Rope", "Adjustable Strap"],
    careInstructions: ["Wipe clean", "Air dry"],
    customizations: [
      {
        name: "Size",
        label: "Choose Size",
        type: "choice",
        required: true,
        values: [
          { label: "Standard (750ml)", value: "standard", priceAdjustment: 0 },
          { label: "Large (1L)", value: "large", priceAdjustment: 100 },
        ],
      },
      {
        name: "Color",
        label: "Choose Color",
        type: "color",
        required: true,
        values: [
          { label: "Tan", value: "#D2B48C" },
          { label: "Brown", value: "#8B4513" },
          { label: "Wheat", value: "#F5DEB3" },
        ],
      },
    ],
  },
  {
    sku: "CR-HAAR-SON-001",
    name: "Sonchafa Haar",
    description: "A traditional Sonchafa crochet haar, handcrafted with care for your home temple — a lasting alternative to fresh flowers.",
    shortDescription: "Handmade Sonchafa crochet garland",
    price: 699,
    categorySlug: "sonchafa-haar",
    tags: ["haar", "garland", "devghar", "pooja"],
    colors: ["#FFA500", "#FFD700"],
    featured: true,
    stock: 10,
    estimatedDelivery: "10-12 business days",
    materials: ["Cotton Yarn", "Cotton Thread"],
    careInstructions: ["Dust gently", "Keep dry"],
    customizations: [
      {
        name: "Length",
        label: "Haar Length",
        type: "choice",
        required: true,
        values: [
          { label: "Small (18 in)", value: "small", priceAdjustment: 0 },
          { label: "Medium (24 in)", value: "medium", priceAdjustment: 150 },
          { label: "Large (32 in)", value: "large", priceAdjustment: 300 },
        ],
      },
    ],
  },
  {
    sku: "CR-HAAR-SJ-001",
    name: "Sonchafa & Jaswand Haar",
    description: "A mixed crochet haar combining Sonchafa and Jaswand blooms — a rich, traditional garland for pooja and festive décor.",
    shortDescription: "Handmade mixed-flower crochet garland",
    price: 799,
    categorySlug: "sonchafa-jaswand-haar",
    tags: ["haar", "garland", "devghar", "pooja"],
    colors: ["#FFA500", "#DC143C"],
    stock: 8,
    estimatedDelivery: "10-12 business days",
    materials: ["Cotton Yarn", "Cotton Thread"],
    careInstructions: ["Dust gently", "Keep dry"],
    customizations: [
      {
        name: "Length",
        label: "Haar Length",
        type: "choice",
        required: true,
        values: [
          { label: "Small (18 in)", value: "small", priceAdjustment: 0 },
          { label: "Medium (24 in)", value: "medium", priceAdjustment: 150 },
          { label: "Large (32 in)", value: "large", priceAdjustment: 300 },
        ],
      },
      {
        name: "FlowerCombination",
        label: "Flower Combination",
        type: "choice",
        required: true,
        values: [
          { label: "Sonchafa Heavy", value: "sonchafa-heavy", priceAdjustment: 0 },
          { label: "Equal Mix", value: "equal-mix", priceAdjustment: 0 },
          { label: "Jaswand Heavy", value: "jaswand-heavy", priceAdjustment: 0 },
        ],
      },
    ],
  },
];

async function seedColors() {
  const colorIdByHex = new Map<string, string>();
  let i = 0;
  for (const [hex, name] of Object.entries(COLORS)) {
    const { data: existing } = await supabaseAdmin.from("colors").select("id").eq("hex", hex).maybeSingle();
    if (existing) {
      colorIdByHex.set(hex, existing.id);
      continue;
    }
    const { data, error } = await supabaseAdmin.from("colors").insert({ name, hex, sort_order: i++ }).select("id").single();
    if (error) throw error;
    colorIdByHex.set(hex, data.id);
  }
  return colorIdByHex;
}

async function seedProducts(colorIdByHex: Map<string, string>) {
  for (const p of PRODUCTS) {
    const { data: category } = await supabaseAdmin.from("categories").select("id").eq("slug", p.categorySlug).maybeSingle();
    if (!category) {
      console.warn(`Category "${p.categorySlug}" not found — skipping "${p.name}". Run 0004_full_taxonomy.sql first.`);
      continue;
    }

    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert({
        sku: p.sku,
        name: p.name,
        slug: p.sku.toLowerCase(),
        description: p.description,
        short_description: p.shortDescription,
        price: p.price,
        compare_price: p.comparePrice,
        category_id: category.id,
        tags: p.tags,
        stock: p.stock,
        featured: p.featured ?? false,
        bestseller: p.bestseller ?? false,
        new_arrival: p.newArrival ?? false,
        estimated_delivery: p.estimatedDelivery,
        materials: p.materials,
        care_instructions: p.careInstructions,
        customizable: Boolean(p.customizations?.length),
      })
      .select("id")
      .single();
    if (error) throw error;

    await supabaseAdmin.from("customization_rules").insert({ product_id: product.id });

    const colorIds = p.colors.map((hex) => colorIdByHex.get(hex)).filter((id): id is string => Boolean(id));
    if (colorIds.length) {
      await supabaseAdmin
        .from("product_colors")
        .insert(colorIds.map((colorId, i) => ({ product_id: product.id, color_id: colorId, sort_order: i })));
    }

    await supabaseAdmin.from("product_images").insert({
      product_id: product.id,
      url: "/placeholder.svg",
      sort_order: 0,
      is_primary: true,
    });

    for (const [gi, group] of (p.customizations ?? []).entries()) {
      const { data: pc, error: pcError } = await supabaseAdmin
        .from("product_customizations")
        .insert({
          product_id: product.id,
          name: group.name,
          label: group.label,
          type: group.type,
          required: group.required,
          sort_order: gi * 2,
        })
        .select("id")
        .single();
      if (pcError) throw pcError;

      const valueRows = group.values.map((v, vi) => ({
        customization_id: pc.id,
        label: v.label,
        value: v.value,
        price_adjustment: v.priceAdjustment ?? 0,
        sort_order: vi,
      }));
      const { data: insertedValues, error: valError } = await supabaseAdmin
        .from("customization_values")
        .insert(valueRows)
        .select("id, label");
      if (valError) throw valError;

      if (group.revealTextGroup) {
        const triggerValue = insertedValues?.find((v) => v.label === group.revealTextGroup!.onValueLabel);
        await supabaseAdmin.from("product_customizations").insert({
          product_id: product.id,
          name: group.revealTextGroup.name,
          label: group.revealTextGroup.label,
          type: "text",
          required: false,
          placeholder: group.revealTextGroup.placeholder,
          max_length: group.revealTextGroup.maxLength,
          sort_order: gi * 2 + 1,
          conditional_parent_value_id: triggerValue?.id,
        });
      }
    }

    console.log(`Seeded "${p.name}" (${p.sku})`);
  }
}

async function main() {
  await clearExistingData();
  const colorIdByHex = await seedColors();
  await seedProducts(colorIdByHex);
  console.log("Reseed complete.");
}

main().catch((err) => {
  console.error("Reseed failed:", err);
  process.exit(1);
});
