/**
 * One-time: seeds nav_items/footer_links with the site's CURRENT hardcoded content (the
 * same fallback arrays navbar.tsx/footer.tsx now use if these tables are empty), so the new
 * Site Settings admin UI starts populated instead of blank. Idempotent — matches on
 * (label, url) and skips if already present. Usage: pnpm tsx scripts/seed-storefront-content.ts
 */
import { supabaseAdmin } from "../src/config/supabase.js";

const NAV_ITEMS = [
  { label: "Home", url: "/", sort_order: 0 },
  { label: "Shop", url: "/shop", sort_order: 10 },
  { label: "About", url: "/about", sort_order: 20 },
  { label: "Contact", url: "/contact", sort_order: 30 },
];

const FOOTER_LINKS: { column_key: string; label: string; url: string; sort_order: number }[] = [
  { column_key: "shop", label: "All Products", url: "/shop", sort_order: 0 },
  { column_key: "shop", label: "Flowers & Floral", url: "/shop?category=flowers-floral", sort_order: 10 },
  { column_key: "shop", label: "Home & Décor", url: "/shop?category=home-and-decor", sort_order: 20 },
  { column_key: "shop", label: "Accessories", url: "/shop?category=accessories-v2", sort_order: 30 },
  { column_key: "shop", label: "Devghar Collection", url: "/shop?category=devghar-collection-v2", sort_order: 40 },
  { column_key: "shop", label: "Kids & Gifts", url: "/shop?category=kids-gifts", sort_order: 50 },
  { column_key: "support", label: "Contact Us", url: "/contact", sort_order: 0 },
  { column_key: "support", label: "FAQs", url: "/faqs", sort_order: 10 },
  { column_key: "support", label: "Shipping Info", url: "/shipping", sort_order: 20 },
  { column_key: "support", label: "Returns & Refunds", url: "/returns", sort_order: 30 },
  { column_key: "support", label: "Track Order", url: "/track-order", sort_order: 40 },
  { column_key: "about", label: "Our Story", url: "/about", sort_order: 0 },
  { column_key: "about", label: "Behind the Yarn", url: "/about#process", sort_order: 10 },
  { column_key: "about", label: "Testimonials", url: "/testimonials", sort_order: 20 },
  { column_key: "about", label: "Blog", url: "/blog", sort_order: 30 },
  { column_key: "policies", label: "Privacy Policy", url: "/privacy", sort_order: 0 },
  { column_key: "policies", label: "Terms of Service", url: "/terms", sort_order: 10 },
  { column_key: "policies", label: "Refund Policy", url: "/refund-policy", sort_order: 20 },
];

async function main() {
  const { count: navCount } = await supabaseAdmin.from("nav_items").select("id", { count: "exact", head: true });
  if (!navCount) {
    const { error } = await supabaseAdmin.from("nav_items").insert(NAV_ITEMS);
    if (error) throw error;
    console.log(`Seeded ${NAV_ITEMS.length} nav items.`);
  } else {
    console.log(`nav_items already has ${navCount} row(s) — skipped.`);
  }

  const { count: footerCount } = await supabaseAdmin.from("footer_links").select("id", { count: "exact", head: true });
  if (!footerCount) {
    const { error } = await supabaseAdmin.from("footer_links").insert(FOOTER_LINKS);
    if (error) throw error;
    console.log(`Seeded ${FOOTER_LINKS.length} footer links.`);
  } else {
    console.log(`footer_links already has ${footerCount} row(s) — skipped.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
