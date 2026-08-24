/**
 * One-time migration utility: transcribes the hardcoded arrays that used to live in
 * suthrayaa/lib/data.ts into real rows, so the newly-dynamic frontend has real content
 * to render. Safe to re-run (upserts by natural key); not part of the running server.
 */
import { supabaseAdmin } from "../src/config/supabase.js";

const COLORS: Record<string, string> = {
  "#FFB5BA": "Blush Pink",
  "#B5D8FF": "Sky Blue",
  "#B5FFD8": "Mint Green",
  "#FFE5B5": "Cream",
  "#E5B5FF": "Lavender",
  "#1a365d": "Navy",
  "#FFFFFF": "White",
  "#F5F5DC": "Beige",
  "#D2B48C": "Tan",
  "#FFD700": "Gold",
  "#FF6347": "Tomato Red",
  "#FF69B4": "Hot Pink",
  "#9370DB": "Purple",
  "#8B4513": "Brown",
  "#F5DEB3": "Wheat",
  "#A0522D": "Sienna",
};

const CATEGORIES = [
  { slug: "keychains", name: "Personalized Keychains", description: "Custom crochet keychains with names, initials, or special messages", sortOrder: 1 },
  { slug: "amigurumi", name: "Amigurumi Toys", description: "Adorable handmade stuffed animals and character toys", sortOrder: 2 },
  { slug: "home-decor", name: "Home Decor", description: "Beautiful crochet pieces to adorn your living spaces", sortOrder: 3 },
  { slug: "baby", name: "Baby Collection", description: "Soft, safe, and adorable items for little ones", sortOrder: 4 },
  { slug: "accessories", name: "Accessories", description: "Scrunchies, bookmarks, bag charms and more", sortOrder: 5 },
  { slug: "custom", name: "Custom Orders", description: "Bring your unique ideas to life with custom crochet", sortOrder: 6 },
];

interface SeedProduct {
  slug: string;
  name: string;
  description: string;
  shortDescription: string;
  price: number;
  comparePrice?: number;
  images: string[];
  categorySlug: string;
  tags: string[];
  colors: string[];
  isCustomizable: boolean;
  customization?: { allowText: boolean; maxTextLength?: number; textPlaceholder?: string };
  stock: number;
  featured: boolean;
  bestseller: boolean;
  newArrival: boolean;
  estimatedDelivery: string;
  dimensions?: string;
  materials: string[];
  careInstructions: string[];
}

const PRODUCTS: SeedProduct[] = [
  {
    slug: "personalized-name-keychain",
    name: "Personalized Name Keychain",
    description:
      "A beautifully handcrafted crochet keychain featuring your chosen name or word. Each letter is carefully crocheted using premium cotton yarn, making it a perfect personalized gift for loved ones. The keychain comes with a sturdy metal ring and clasp.",
    shortDescription: "Custom crochet keychain with your name",
    price: 299,
    comparePrice: 399,
    images: ["/products/personalized-keychain.jpg", "/categories/keychains.jpg"],
    categorySlug: "keychains",
    tags: ["personalized", "gift", "keychain", "name"],
    colors: ["#FFB5BA", "#B5D8FF", "#B5FFD8", "#FFE5B5", "#E5B5FF", "#1a365d"],
    isCustomizable: true,
    customization: { allowText: true, maxTextLength: 10, textPlaceholder: "Enter name (max 10 chars)" },
    stock: 50,
    featured: true,
    bestseller: true,
    newArrival: false,
    estimatedDelivery: "5-7 business days",
    dimensions: "8cm x 3cm",
    materials: ["100% Cotton Yarn", "Metal Keyring", "Polyester Fiberfill"],
    careInstructions: ["Spot clean only", "Keep away from water", "Store in dry place"],
  },
  {
    slug: "cute-bunny-amigurumi",
    name: "Cute Bunny Amigurumi",
    description:
      "An adorable handmade bunny plush toy, perfect for children and collectors alike. This soft and cuddly amigurumi is made with hypoallergenic cotton yarn and stuffed with premium polyester fiberfill. Safety eyes are securely attached.",
    shortDescription: "Handmade crochet bunny toy",
    price: 599,
    comparePrice: 749,
    images: ["/products/amigurumi-bunny.jpg", "/categories/toys.jpg"],
    categorySlug: "amigurumi",
    tags: ["toy", "bunny", "amigurumi", "kids", "gift"],
    colors: ["#FFB5BA", "#FFFFFF", "#B5D8FF", "#FFE5B5"],
    isCustomizable: false,
    stock: 25,
    featured: true,
    bestseller: true,
    newArrival: false,
    estimatedDelivery: "7-10 business days",
    dimensions: "20cm x 10cm x 8cm",
    materials: ["Cotton Yarn", "Polyester Fiberfill", "Safety Eyes"],
    careInstructions: ["Machine wash cold", "Tumble dry low", "Do not bleach"],
  },
  {
    slug: "macrame-plant-hanger",
    name: "Macrame Plant Hanger",
    description:
      "Elevate your indoor garden with this stunning handwoven macrame plant hanger. Perfect for displaying your favorite potted plants, this bohemian-style hanger adds warmth and texture to any room.",
    shortDescription: "Bohemian-style crochet plant hanger",
    price: 449,
    images: ["/products/macrame-plant-hanger.jpg", "/categories/home-decor.jpg"],
    categorySlug: "home-decor",
    tags: ["home", "decor", "plant", "macrame", "bohemian"],
    colors: ["#F5F5DC", "#FFFFFF", "#D2B48C"],
    isCustomizable: false,
    stock: 30,
    featured: true,
    bestseller: false,
    newArrival: true,
    estimatedDelivery: "5-7 business days",
    dimensions: "100cm length",
    materials: ["Natural Cotton Rope", "Wooden Ring"],
    careInstructions: ["Dust regularly", "Keep away from direct sunlight", "Spot clean if needed"],
  },
  {
    slug: "baby-booties-set",
    name: "Baby Booties Set",
    description:
      "Precious handmade baby booties crafted with the softest organic cotton yarn. These adorable booties keep tiny feet warm and cozy. Available in multiple colors, they make a perfect baby shower gift.",
    shortDescription: "Soft crochet booties for newborns",
    price: 349,
    images: ["/products/baby-booties.jpg", "/categories/baby.jpg"],
    categorySlug: "baby",
    tags: ["baby", "booties", "newborn", "gift", "organic"],
    colors: ["#FFB5BA", "#B5D8FF", "#FFFFFF", "#FFE5B5"],
    isCustomizable: false,
    stock: 40,
    featured: false,
    bestseller: true,
    newArrival: false,
    estimatedDelivery: "5-7 business days",
    dimensions: "0-6 months size",
    materials: ["Organic Cotton Yarn", "Satin Ribbon"],
    careInstructions: ["Hand wash cold", "Lay flat to dry", "Do not tumble dry"],
  },
  {
    slug: "diwali-diya-coasters",
    name: "Diwali Diya Coasters Set",
    description:
      "Celebrate the festival of lights with these beautiful handmade crochet coasters inspired by traditional diyas. Set of 4 coasters in festive colors, perfect for protecting your surfaces while adding a touch of celebration.",
    shortDescription: "Festive crochet coasters set of 4",
    price: 399,
    images: ["/products/floral-coaster-set.jpg", "/categories/accessories.jpg"],
    categorySlug: "accessories",
    tags: ["diwali", "festive", "coasters", "home", "indian"],
    colors: ["#FFD700", "#FF6347", "#FF69B4", "#9370DB"],
    isCustomizable: false,
    stock: 35,
    featured: true,
    bestseller: false,
    newArrival: true,
    estimatedDelivery: "5-7 business days",
    dimensions: "10cm diameter each",
    materials: ["Cotton Yarn", "Felt Backing"],
    careInstructions: ["Spot clean only", "Do not machine wash", "Iron on low if needed"],
  },
  {
    slug: "initial-letter-keychain",
    name: "Initial Letter Keychain",
    description:
      "A charming single-letter keychain perfect for personalizing bags, keys, or gifts. Each letter is carefully crocheted with attention to detail, featuring a decorative border.",
    shortDescription: "Single letter crochet keychain",
    price: 199,
    comparePrice: 249,
    images: ["/products/bag-charm.jpg", "/products/personalized-keychain.jpg"],
    categorySlug: "keychains",
    tags: ["initial", "letter", "keychain", "personalized", "gift"],
    colors: ["#FFB5BA", "#B5D8FF", "#B5FFD8", "#FFE5B5", "#E5B5FF", "#1a365d"],
    isCustomizable: true,
    customization: { allowText: true, maxTextLength: 1, textPlaceholder: "Enter single letter" },
    stock: 100,
    featured: false,
    bestseller: true,
    newArrival: false,
    estimatedDelivery: "3-5 business days",
    dimensions: "5cm x 5cm",
    materials: ["100% Cotton Yarn", "Metal Keyring"],
    careInstructions: ["Spot clean only", "Keep away from water"],
  },
  {
    slug: "teddy-bear-amigurumi",
    name: "Teddy Bear Amigurumi",
    description:
      "A classic teddy bear reimagined in crochet. This huggable friend features embroidered features for safety and is filled with premium hypoallergenic stuffing. Perfect for all ages.",
    shortDescription: "Classic crochet teddy bear",
    price: 699,
    images: ["/products/amigurumi-bunny.jpg", "/categories/toys.jpg"],
    categorySlug: "amigurumi",
    tags: ["teddy", "bear", "toy", "classic", "gift"],
    colors: ["#D2B48C", "#8B4513", "#F5DEB3", "#FFB5BA"],
    isCustomizable: false,
    stock: 20,
    featured: false,
    bestseller: false,
    newArrival: true,
    estimatedDelivery: "7-10 business days",
    dimensions: "25cm x 15cm x 10cm",
    materials: ["Cotton Yarn", "Polyester Fiberfill", "Embroidery Thread"],
    careInstructions: ["Surface wash only", "Air dry", "Brush gently to restore fluffiness"],
  },
  {
    slug: "crochet-basket-set",
    name: "Crochet Basket Set",
    description:
      "Organize in style with this set of 3 nesting crochet baskets. Perfect for storing small items, cosmetics, or desk accessories. Handmade with sturdy cotton rope for durability.",
    shortDescription: "Set of 3 nesting storage baskets",
    price: 549,
    images: ["/categories/home-decor.jpg", "/products/macrame-plant-hanger.jpg"],
    categorySlug: "home-decor",
    tags: ["basket", "storage", "organization", "home", "set"],
    colors: ["#F5F5DC", "#FFFFFF", "#D2B48C", "#A0522D"],
    isCustomizable: false,
    stock: 25,
    featured: false,
    bestseller: false,
    newArrival: false,
    estimatedDelivery: "7-10 business days",
    dimensions: "Small: 10cm, Medium: 15cm, Large: 20cm diameter",
    materials: ["Cotton Rope", "Jute Accents"],
    careInstructions: ["Wipe with damp cloth", "Air dry", "Reshape while damp if needed"],
  },
];

const REVIEWS = [
  { productSlug: "personalized-name-keychain", customerName: "Priya S.", rating: 5, title: "Perfect gift for my sister!", content: "I ordered a personalized keychain with my sister's name for her birthday. The quality is amazing and the colors are exactly as shown. She absolutely loved it! Will definitely order more." },
  { productSlug: "personalized-name-keychain", customerName: "Rahul M.", rating: 5, title: "Exceeded expectations", content: "The craftsmanship is incredible. You can tell so much love goes into each piece. Fast shipping and beautiful packaging too!" },
  { productSlug: "cute-bunny-amigurumi", customerName: "Ananya K.", rating: 5, title: "My daughter loves it!", content: "The bunny is absolutely adorable. It's soft, well-made, and the perfect size for cuddling. My 3-year-old hasn't put it down since she got it." },
  { productSlug: "baby-booties-set", customerName: "Meera P.", rating: 5, title: "Beautiful baby gift", content: "Ordered these for my friend's baby shower. The booties are so soft and the packaging was lovely. Everyone at the shower wanted to know where I got them!" },
];

const TESTIMONIALS = [
  { customerName: "Sneha Sharma", location: "Mumbai", content: "I've ordered multiple keychains from Suthrayaa and each one has been perfect. The attention to detail and quality is unmatched. These make the best personalized gifts!", rating: 5, productPurchased: "Personalized Name Keychain" },
  { customerName: "Aditya Patel", location: "Bangalore", content: "Got an amigurumi bunny for my niece and she absolutely adores it. The quality is amazing and it's clear that so much care goes into each piece. Highly recommend!", rating: 5, productPurchased: "Cute Bunny Amigurumi" },
  { customerName: "Kavitha Reddy", location: "Hyderabad", content: "The macrame plant hanger is beautiful and exactly what I was looking for. It adds such a cozy touch to my living room. Will definitely be ordering more home decor pieces!", rating: 5, productPurchased: "Macrame Plant Hanger" },
  { customerName: "Deepak Kumar", location: "Delhi", content: "Ordered custom keychains for my entire team as Diwali gifts. Everyone loved them! The customization options and quick delivery made it a seamless experience.", rating: 5, productPurchased: "Initial Letter Keychain" },
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
    const { data, error } = await supabaseAdmin
      .from("colors")
      .insert({ name, hex, sort_order: i++ })
      .select("id")
      .single();
    if (error) throw error;
    colorIdByHex.set(hex, data.id);
  }
  console.log(`Seeded ${colorIdByHex.size} colors.`);
  return colorIdByHex;
}

async function seedCategories() {
  const categoryIdBySlug = new Map<string, string>();
  for (const c of CATEGORIES) {
    const { data: existing } = await supabaseAdmin.from("categories").select("id").eq("slug", c.slug).maybeSingle();
    if (existing) {
      categoryIdBySlug.set(c.slug, existing.id);
      continue;
    }
    const { data, error } = await supabaseAdmin
      .from("categories")
      .insert({ slug: c.slug, name: c.name, description: c.description, sort_order: c.sortOrder })
      .select("id")
      .single();
    if (error) throw error;
    categoryIdBySlug.set(c.slug, data.id);
  }
  console.log(`Seeded ${categoryIdBySlug.size} categories.`);
  return categoryIdBySlug;
}

async function seedProducts(categoryIdBySlug: Map<string, string>, colorIdByHex: Map<string, string>) {
  const productIdBySlug = new Map<string, string>();

  for (const p of PRODUCTS) {
    const { data: existing } = await supabaseAdmin.from("products").select("id").eq("slug", p.slug).maybeSingle();
    if (existing) {
      productIdBySlug.set(p.slug, existing.id);
      console.log(`Product "${p.slug}" already exists — skipping insert.`);
      continue;
    }

    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert({
        slug: p.slug,
        name: p.name,
        description: p.description,
        short_description: p.shortDescription,
        price: p.price,
        compare_price: p.comparePrice,
        category_id: categoryIdBySlug.get(p.categorySlug),
        tags: p.tags,
        stock: p.stock,
        featured: p.featured,
        bestseller: p.bestseller,
        new_arrival: p.newArrival,
        estimated_delivery: p.estimatedDelivery,
        dimensions: p.dimensions,
        materials: p.materials,
        care_instructions: p.careInstructions,
      })
      .select("id")
      .single();
    if (error) throw error;
    productIdBySlug.set(p.slug, product.id);

    await supabaseAdmin.from("product_images").insert(
      p.images.map((url, i) => ({ product_id: product.id, url, sort_order: i, is_primary: i === 0 }))
    );

    const colorIds = p.colors.map((hex) => colorIdByHex.get(hex)).filter((id): id is string => Boolean(id));
    if (colorIds.length) {
      await supabaseAdmin
        .from("product_colors")
        .insert(colorIds.map((colorId, i) => ({ product_id: product.id, color_id: colorId, sort_order: i })));
    }

    await supabaseAdmin.from("customization_rules").insert({
      product_id: product.id,
      is_customizable: p.isCustomizable,
      allow_color_choice: true,
      allow_text: p.customization?.allowText ?? false,
      max_text_length: p.customization?.maxTextLength,
      text_placeholder: p.customization?.textPlaceholder,
    });
  }

  console.log(`Seeded ${productIdBySlug.size} products.`);
  return productIdBySlug;
}

async function seedReviews(productIdBySlug: Map<string, string>) {
  let count = 0;
  for (const r of REVIEWS) {
    const productId = productIdBySlug.get(r.productSlug);
    if (!productId) continue;
    const { data: existing } = await supabaseAdmin
      .from("reviews")
      .select("id")
      .eq("product_id", productId)
      .eq("customer_name", r.customerName)
      .eq("title", r.title)
      .maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from("reviews").insert({
      product_id: productId,
      customer_name: r.customerName,
      rating: r.rating,
      title: r.title,
      content: r.content,
      is_verified_purchase: true,
      is_published: true,
    });
    if (error) throw error;
    count++;
  }
  console.log(`Seeded ${count} reviews.`);
}

async function seedTestimonials() {
  let count = 0;
  for (const t of TESTIMONIALS) {
    const { data: existing } = await supabaseAdmin
      .from("testimonials")
      .select("id")
      .eq("customer_name", t.customerName)
      .maybeSingle();
    if (existing) continue;

    const { error } = await supabaseAdmin.from("testimonials").insert({
      customer_name: t.customerName,
      location: t.location,
      content: t.content,
      rating: t.rating,
      product_purchased: t.productPurchased,
      is_published: true,
    });
    if (error) throw error;
    count++;
  }
  console.log(`Seeded ${count} testimonials.`);
}

async function seedWelcomeCoupon() {
  const { data: existing } = await supabaseAdmin.from("coupons").select("id").eq("code", "WELCOME10").maybeSingle();
  if (existing) return;
  const { error } = await supabaseAdmin.from("coupons").insert({
    code: "WELCOME10",
    type: "percent",
    value: 10,
    min_subtotal: 0,
    is_active: true,
  });
  if (error) throw error;
  console.log("Seeded WELCOME10 coupon.");
}

async function main() {
  const colorIdByHex = await seedColors();
  const categoryIdBySlug = await seedCategories();
  const productIdBySlug = await seedProducts(categoryIdBySlug, colorIdByHex);
  await seedReviews(productIdBySlug);
  await seedTestimonials();
  await seedWelcomeCoupon();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
