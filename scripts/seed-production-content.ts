/**
 * Production content setup: fills every static, customer-facing piece of the storefront so a
 * fresh production database looks finished and is fully editable from the admin — WITHOUT
 * touching products, categories, orders, customers or anything transactional.
 *
 * Writes (all validated through the same services the admin uses):
 *   • Storefront Content — every block in content.catalog.ts: homepage badges, promo, story,
 *     reels, 2-in-1 showcase, Instagram, About, FAQs, Contact, Shipping, Returns, Refund,
 *     Privacy, Terms, header perks, footer extras
 *   • Homepage sections — headings, eyebrows, descriptions, buttons, order and on/off
 *   • Header navigation and footer link columns
 *   • Homepage hero slides (only when there are none)
 *   • Storefront settings — store description, SEO, footer, announcement bar, support hours
 *
 * Deliberately NOT written (fill these in Admin → Site Settings — they're your legal/business
 * facts, and the script prints which are still empty): business legal name & address, GSTIN,
 * support phone / WhatsApp, social profile URLs, analytics IDs, payment keys.
 * Testimonials are not seeded either — publish only real customer quotes.
 *
 * Safe by default: only fills what's missing, never overwrites an admin's edits.
 *   npx tsx scripts/seed-production-content.ts              # fill gaps only
 *   npx tsx scripts/seed-production-content.ts --overwrite  # reset all of the above to this copy
 *   npx tsx scripts/seed-production-content.ts --dry-run    # show what would change
 */
import { supabaseAdmin } from "../src/config/supabase.js";
import { CONTENT_BLOCKS } from "../src/modules/content/content.catalog.js";
import { saveContent } from "../src/modules/content/content.service.js";
import { SETTINGS } from "../src/modules/settings/settings.catalog.js";
import { setSettings } from "../src/modules/settings/settings.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const OVERWRITE = process.argv.includes("--overwrite");
const DRY_RUN = process.argv.includes("--dry-run");
const log = (msg: string) => console.log(`${DRY_RUN ? "[dry-run] " : ""}${msg}`);

// ---------------------------------------------------------------- homepage sections
// Titles mark the italic accent with *asterisks*; `subtitle` is the small eyebrow above.

interface SectionCopy {
  enabled: boolean;
  sort: number;
  title?: string;
  subtitle?: string;
  description?: string;
  button_text?: string;
  button_url?: string;
}

const HOMEPAGE_SECTIONS: Record<string, SectionCopy> = {
  hero_banner: { enabled: true, sort: 0 },
  trust_badges: { enabled: true, sort: 10 },
  featured_categories: {
    enabled: true,
    sort: 20,
    subtitle: "Explore the collection",
    title: "Shop by *category*",
    button_text: "Browse all",
    button_url: "/shop",
  },
  reels: {
    enabled: true,
    sort: 30,
    subtitle: "Suthrayaa reels",
    title: "See them *up close*",
    description: "Short clips of our pieces — tap one to shop the collection.",
  },
  featured_products: {
    enabled: true,
    sort: 40,
    subtitle: "Handpicked for you",
    title: "Featured *creations*",
    button_text: "View all products",
    button_url: "/shop",
  },
  story: { enabled: true, sort: 50 },
  new_arrivals: {
    enabled: true,
    sort: 60,
    subtitle: "Fresh off the hook",
    title: "New *arrivals*",
    button_text: "View all",
    button_url: "/shop?sort=newest",
  },
  best_sellers: {
    enabled: true,
    sort: 70,
    subtitle: "Customer favourites",
    title: "Best *sellers*",
    button_text: "View all best sellers",
    button_url: "/shop?sort=bestselling",
  },
  convertible_showcase: { enabled: true, sort: 80 },
  promotional_banner: { enabled: true, sort: 90 },
  testimonials: {
    enabled: true,
    sort: 100,
    subtitle: "Kind words",
    title: "Loved by *our community*",
    description: "Real stories from people who’ve gifted, cuddled and kept our handmade pieces.",
  },
  instagram: {
    enabled: true,
    sort: 110,
    subtitle: "@suthrayaa",
    title: "Made for sharing, *loved on Instagram*",
    description: "Behind-the-scenes peeks, new drops and your beautiful photos — tag us to be featured.",
  },
  newsletter: {
    enabled: true,
    sort: 120,
    title: "Join the Suthrayaa circle",
    description: "New designs, festive drops and studio stories — a few times a month, never spam.",
  },
  // Available, switched off until there's enough catalogue for them to look full
  trending: {
    enabled: false,
    sort: 130,
    subtitle: "Top rated this season",
    title: "Trending *now*",
    button_text: "View all",
    button_url: "/shop?sort=rating",
  },
  sale_products: {
    enabled: false,
    sort: 140,
    subtitle: "Limited-time prices",
    title: "On *sale*",
    button_text: "Shop the sale",
    button_url: "/shop",
  },
  collections: {
    enabled: false,
    sort: 150,
    subtitle: "Curated for every corner",
    title: "Our *collections*",
    button_text: "Browse all",
    button_url: "/shop",
  },
};

// The plain titles migration 0012 seeded — they override the designed headings, so they're
// treated as "not set" and replaced even without --overwrite.
const MIGRATION_TITLES = new Set([
  "Shop by Category",
  "Featured Products",
  "New Arrivals",
  "Best Sellers",
  "Trending Now",
  "On Sale",
  "Collections",
  "What Our Customers Say",
  "Follow Us on Instagram",
  "Stay in the Loop",
]);

// ---------------------------------------------------------------- navigation
// Only links that work on any catalogue — category links belong in the footer once
// categories exist (add them in Admin → Site Settings → Navigation).

const NAV_ITEMS = [
  { label: "Home", url: "/", sort_order: 0 },
  { label: "Shop", url: "/shop", sort_order: 10 },
  { label: "New Arrivals", url: "/shop?sort=newest", sort_order: 20 },
  { label: "Our Story", url: "/about", sort_order: 30 },
  { label: "Contact", url: "/contact", sort_order: 40 },
];

const FOOTER_LINKS = [
  { column_key: "shop", label: "All Products", url: "/shop", sort_order: 0 },
  { column_key: "shop", label: "New Arrivals", url: "/shop?sort=newest", sort_order: 10 },
  { column_key: "shop", label: "Best Sellers", url: "/shop?sort=bestselling", sort_order: 20 },
  { column_key: "shop", label: "Wishlist", url: "/wishlist", sort_order: 30 },
  { column_key: "support", label: "Contact Us", url: "/contact", sort_order: 0 },
  { column_key: "support", label: "FAQs", url: "/faqs", sort_order: 10 },
  { column_key: "support", label: "Shipping Info", url: "/shipping", sort_order: 20 },
  { column_key: "support", label: "Returns & Refunds", url: "/returns", sort_order: 30 },
  { column_key: "support", label: "Track Your Order", url: "/account/orders", sort_order: 40 },
  { column_key: "about", label: "Our Story", url: "/about", sort_order: 0 },
  { column_key: "about", label: "Behind the Yarn", url: "/about#process", sort_order: 10 },
  { column_key: "about", label: "Testimonials", url: "/#testimonials", sort_order: 20 },
  { column_key: "policies", label: "Privacy Policy", url: "/privacy", sort_order: 0 },
  { column_key: "policies", label: "Terms & Conditions", url: "/terms", sort_order: 10 },
  { column_key: "policies", label: "Shipping Policy", url: "/shipping", sort_order: 20 },
  { column_key: "policies", label: "Refund Policy", url: "/refund-policy", sort_order: 30 },
];

// ---------------------------------------------------------------- hero slides
// The homepage carousel. Titles split at the first full stop / comma — the second half is set
// in the italic accent. Images ship with the storefront (public/editorial); replace them with
// uploads in Admin → Hero Slides any time. Links point at collections that exist in the catalogue.

const HERO_SLIDES = [
  {
    title: "Garlands for your devghar. Stitched with devotion.",
    subtitle: "Pooja & devghar collection",
    description: "Sonchafa and jaswand haars that stay fresh for every puja — hooked by hand, flower by flower.",
    image_url: "/editorial/scene-devghar.webp",
    cta_label: "Shop the devghar collection",
    cta_href: "/shop?category=devghar-collection-v2",
  },
  {
    title: "Forever flowers. Never wilting.",
    subtitle: "Crochet flowers & bouquets",
    description: "Sunflowers, lilies and hibiscus stems in every shade of sunshine — bright all year, no watering needed.",
    image_url: "/editorial/scene-sunflowers.webp",
    cta_label: "Shop flowers",
    cta_href: "/shop?category=flowers-floral",
  },
  {
    title: "Doorways and tables, made festive.",
    subtitle: "Home décor",
    description: "Floral door hangings and coaster sets that bring colour to every entrance and every chai break.",
    image_url: "/editorial/scene-rosetoran-marigold.webp",
    cta_label: "Shop home décor",
    cta_href: "/shop?category=home-and-decor",
  },
  {
    title: "Soft on hair. Pretty all day.",
    subtitle: "Hairbands & hair ties",
    description: "Crochet hairbands and flower hair ties that hold gently and never snag — lovely for school, work and weddings.",
    image_url: "/editorial/scene-hairband-pastel.webp",
    cta_label: "Shop hair accessories",
    cta_href: "/shop?search=hair",
  },
  {
    title: "Tiny keychains. Big personality.",
    subtitle: "Flower keychains",
    description: "Little crochet blooms to clip on your keys or bag — made by hand, easy to gift.",
    image_url: "/editorial/scene-flowerkeys.webp",
    cta_label: "Shop keychains",
    cta_href: "/shop?search=keychain",
  },
];

// ---------------------------------------------------------------- storefront settings
// Copy that describes the shop. The catalog defaults describe "yarn, kits & craft supplies";
// Suthrayaa sells finished, handmade crochet pieces, so SEO and the footer say that.

const STOREFRONT_SETTINGS: Record<string, unknown> = {
  "store.tagline": "Handcrafted with love",
  "store.description":
    "Handmade crochet gifts, décor and keepsakes — garlands, torans, flowers, keychains and personalised pieces, made to order in small batches across India.",
  "seo.site_title": "Suthrayaa | Handmade Crochet Gifts, Décor & Personalised Keepsakes",
  "seo.meta_description":
    "Shop handmade crochet from Suthrayaa — pooja garlands, door torans, forever flowers, keychains and personalised gifts, crafted stitch by stitch and shipped across India.",
  "seo.robots": "index, follow",
  "footer.description":
    "Handcrafted crochet made to order in small batches. Every piece is stitched by hand with premium cotton yarn — made to be gifted, kept and loved.",
  "footer.copyright_text": "© Suthrayaa. All rights reserved.",
  "footer.newsletter_enabled": true,
  "header.announcement_text": "Free shipping across India on orders above ₹999 · Handmade to order",
  "header.announcement_link": "/shipping",
  "contact.support_hours": "Monday – Saturday, 10:00 AM – 7:00 PM IST",
  "contact.business_hours": "Monday – Saturday, 10:00 AM – 7:00 PM IST",
  "legal.privacy_url": "/privacy",
  "legal.terms_url": "/terms",
  "legal.shipping_policy_url": "/shipping",
  "legal.return_policy_url": "/returns",
  "legal.refund_policy_url": "/refund-policy",
  // GA4 ecommerce + Meta Pixel only load after the visitor accepts (India's DPDP Act, and good practice)
  "legal.cookie_consent_enabled": true,
  "legal.cookie_message": "We use cookies to keep your cart, understand how the shop is used and improve it. See our privacy policy for details.",
};

/** Business facts the script won't invent — reported if still empty after it runs. */
const MUST_FILL = [
  "business.legal_name",
  "business.address_line1",
  "business.city",
  "business.state",
  "business.pincode",
  "business.gst_state",
  "store.support_phone",
  "contact.support_email",
  "social.instagram_url",
  "seo.canonical_url",
  "seo.default_og_image",
  "analytics.ga_measurement_id",
];

// ---------------------------------------------------------------- steps

async function adminId(): Promise<string> {
  const { data } = await supabaseAdmin.from("admin_users").select("id").eq("is_active", true).limit(1).maybeSingle();
  if (!data) throw new Error("No active admin user — create one first (npm run create:admin).");
  return data.id;
}

async function seedContent(userId: string) {
  const { data: rows, error } = await supabaseAdmin.from("page_content").select("key");
  if (error) throw error;
  const existing = new Set((rows ?? []).map((r) => r.key));
  let written = 0;
  for (const block of CONTENT_BLOCKS) {
    if (existing.has(block.key) && !OVERWRITE) continue;
    if (!DRY_RUN) await saveContent(block.key, block.default, userId);
    log(`  content  ${existing.has(block.key) ? "reset  " : "added  "} ${block.key}`);
    written++;
  }
  console.log(`Storefront content: ${written} written, ${CONTENT_BLOCKS.length - written} already customised (kept).`);
}

async function seedHomepageSections() {
  const { data: rows, error } = await supabaseAdmin.from("homepage_sections").select("*");
  if (error) throw error;
  const byKey = new Map((rows ?? []).map((r: any) => [r.section_key, r]));
  let written = 0;
  for (const [key, copy] of Object.entries(HOMEPAGE_SECTIONS)) {
    const row: any = byKey.get(key);
    const unset = (field: string) => OVERWRITE || !row || row[field] == null || String(row[field]).trim() === "" || (field === "title" && MIGRATION_TITLES.has(row.title));
    const patch: Record<string, unknown> = {};
    for (const field of ["title", "subtitle", "description", "button_text", "button_url"] as const) {
      if (copy[field] !== undefined && unset(field)) patch[field] = copy[field];
    }
    // Layout (order, on/off) is only set on first run or with --overwrite — never undo an admin's arrangement
    if (!row || OVERWRITE) Object.assign(patch, { enabled: copy.enabled, sort_order: copy.sort });
    if (Object.keys(patch).length === 0) continue;
    if (!DRY_RUN) {
      const { error: upErr } = row
        ? await supabaseAdmin.from("homepage_sections").update(patch).eq("id", row.id)
        : await supabaseAdmin.from("homepage_sections").insert({ section_key: key, ...patch });
      if (upErr) throw new Error(`homepage_sections ${key}: ${upErr.message}`);
    }
    log(`  section  ${row ? "updated" : "added  "} ${key} (${Object.keys(patch).join(", ")})`);
    written++;
  }
  console.log(`Homepage sections: ${written} updated.`);
}

async function seedLinks(table: "nav_items" | "footer_links", links: Record<string, unknown>[]) {
  const { count, error } = await supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  if (error) throw error;
  if (count && !OVERWRITE) {
    console.log(`${table}: ${count} existing link(s) kept.`);
    return;
  }
  if (!DRY_RUN) {
    if (count) {
      const { error: delErr } = await supabaseAdmin.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (delErr) throw delErr;
    }
    const { error: insErr } = await supabaseAdmin.from(table).insert(links.map((l) => ({ ...l, is_active: true })));
    if (insErr) throw new Error(`${table}: ${insErr.message}`);
  }
  log(`${table}: ${count ? "replaced with" : "added"} ${links.length} links.`);
}

async function seedHeroSlides() {
  const { count, error } = await supabaseAdmin.from("hero_slides").select("id", { count: "exact", head: true });
  if (error) throw error;
  if (count && !OVERWRITE) {
    console.log(`hero_slides: ${count} existing slide(s) kept.`);
    return;
  }
  if (!DRY_RUN) {
    if (count) {
      const { error: delErr } = await supabaseAdmin.from("hero_slides").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (delErr) throw delErr;
    }
    const { error: insErr } = await supabaseAdmin.from("hero_slides").insert(HERO_SLIDES.map((sl, i) => ({ ...sl, sort_order: i * 10, is_active: true })));
    if (insErr) throw new Error(`hero_slides: ${insErr.message}`);
  }
  log(`hero_slides: ${count ? "replaced with" : "added"} ${HERO_SLIDES.length} slides.`);
}

async function seedSettings(userId: string) {
  const { data: rows, error } = await supabaseAdmin.from("site_settings").select("key");
  if (error) throw error;
  const saved = new Set((rows ?? []).map((r) => r.key));
  const patch = Object.fromEntries(Object.entries(STOREFRONT_SETTINGS).filter(([k]) => OVERWRITE || !saved.has(k)));
  if (Object.keys(patch).length && !DRY_RUN) await setSettings(patch, userId);
  for (const k of Object.keys(patch)) log(`  setting  ${k}`);
  console.log(`Storefront settings: ${Object.keys(patch).length} written, ${Object.keys(STOREFRONT_SETTINGS).length - Object.keys(patch).length} already set (kept).`);
}

async function reportMissing() {
  const { data } = await supabaseAdmin.from("site_settings").select("key, value").in("key", MUST_FILL);
  const values = new Map((data ?? []).map((r) => [r.key, r.value]));
  const missing = MUST_FILL.filter((k) => {
    const v = values.has(k) ? values.get(k) : SETTINGS.find((s) => s.key === k)?.default;
    return v == null || String(v).trim() === "";
  });
  if (missing.length) {
    console.log("\nStill to fill in Admin → Site Settings (business facts this script won't guess):");
    for (const k of missing) console.log(`  - ${SETTINGS.find((s) => s.key === k)?.label ?? k}  (${k})`);
  }
  const { count } = await supabaseAdmin.from("testimonials").select("id", { count: "exact", head: true }).eq("is_published", true);
  if (!count) console.log("\nNo published testimonials — the homepage testimonials section stays hidden until you add real ones in Admin → Testimonials.");
}

async function main() {
  console.log(`Production storefront content — ${OVERWRITE ? "OVERWRITE mode: resetting to this copy" : "filling gaps only (existing edits kept)"}${DRY_RUN ? ", dry run" : ""}\n`);
  const userId = await adminId();
  await seedContent(userId);
  await seedHomepageSections();
  await seedLinks("nav_items", NAV_ITEMS);
  await seedLinks("footer_links", FOOTER_LINKS);
  await seedHeroSlides();
  await seedSettings(userId);
  await reportMissing();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
