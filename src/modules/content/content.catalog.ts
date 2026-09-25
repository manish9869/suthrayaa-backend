import { z, type ZodTypeAny } from "zod";
import { POLICY_DEFAULTS } from "./policies.defaults.js";

/**
 * Storefront content catalog — every structured block of customer-facing copy/imagery that
 * admins can edit in Admin → Storefront Content. Each block declares:
 *   • fields  — drives both backend validation (zod, generated below) and the admin form UI
 *   • default — the storefront's original copy; used until an admin saves an edit, and
 *               restored by "Reset to default"
 * Stored values live in the `page_content` table (key → JSON).
 *
 * Text conventions the storefront understands:
 *   • Headings: wrap words in *asterisks* for the italic accent, e.g. "Every stitch *tells a story*"
 *   • `markdown` fields: blank line = new paragraph, "- " = bullet, **bold**, [label](/link),
 *     and {{email}} is replaced with the store's support email.
 *   • `icon` fields take a name from CONTENT_ICONS.
 */

export type FieldType = "text" | "textarea" | "markdown" | "url" | "image" | "video" | "icon" | "list";

export interface ContentField {
  name: string;
  label: string;
  type: FieldType;
  help?: string;
  /** list only */
  fields?: ContentField[];
  itemLabel?: string;
  max?: number;
}

export interface ContentBlock {
  key: string;
  group: "Homepage" | "Pages" | "Policies" | "Site-wide" | "Footer";
  label: string;
  description: string;
  /** Where it shows on the storefront (admin "view on site" link). */
  previewPath: string;
  fields: ContentField[];
  default: Record<string, unknown>;
}

/** Icon names the storefront can render (mapped to lucide icons in the frontend). */
export const CONTENT_ICONS = [
  "truck", "rotate-ccw", "shield-check", "gem", "award", "headphones", "heart", "leaf", "sparkles",
  "users", "gift", "star", "package", "package-check", "clock", "map-pin", "phone", "mail",
  "credit-card", "smile", "scissors", "palette", "flower", "home", "sun", "badge-check", "hand-heart", "recycle",
] as const;

const text = (name: string, label: string, help?: string): ContentField => ({ name, label, type: "text", help });
const textarea = (name: string, label: string, help?: string): ContentField => ({ name, label, type: "textarea", help });
const url = (name: string, label: string, help?: string): ContentField => ({ name, label, type: "url", help });
const image = (name: string, label: string, help?: string): ContentField => ({ name, label, type: "image", help });
const icon = (name: string, label = "Icon"): ContentField => ({ name, label, type: "icon" });
const list = (name: string, label: string, itemLabel: string, fields: ContentField[], max = 30, help?: string): ContentField => ({
  name,
  label,
  type: "list",
  itemLabel,
  fields,
  max,
  help,
});

const HEADING_HELP = "Wrap words in *asterisks* to show them in the italic accent colour.";

const policyBlock = (key: string, label: string, path: string, def: Record<string, unknown>): ContentBlock => ({
  key,
  group: "Policies",
  label,
  description: `The ${label} page.`,
  previewPath: path,
  fields: [
    text("eyebrow", "Eyebrow"),
    text("title", "Page title"),
    textarea("description", "Intro", "Shown under the title — a good place for “Last updated: …”."),
    list("sections", "Sections", "Section", [text("title", "Heading"), { name: "body", label: "Body", type: "markdown" }], 40),
  ],
  default: def,
});

export const CONTENT_BLOCKS: ContentBlock[] = [
  // ---------------------------------------------------------------- Homepage
  {
    key: "home.trust_badges",
    group: "Homepage",
    label: "Trust badges",
    description: "The four promise badges under the hero banner.",
    previewPath: "/",
    fields: [list("items", "Badges", "Badge", [icon("icon"), text("title", "Title"), text("description", "Description")], 6)],
    default: {
      items: [
        { icon: "truck", title: "Free shipping", description: "On orders above ₹999" },
        { icon: "rotate-ccw", title: "Easy returns", description: "7-day hassle-free returns" },
        { icon: "shield-check", title: "Secure checkout", description: "UPI, cards & net banking" },
        { icon: "gem", title: "Premium quality", description: "100% cotton, finished by hand" },
      ],
    },
  },
  {
    key: "home.promo",
    group: "Homepage",
    label: "Promo banner & coupon",
    description: "The sale banner, first-order coupon card and deal-of-the-day card. The coupon code must exist (and be active) in Admin → Coupons.",
    previewPath: "/",
    fields: [
      text("saleEyebrow", "Sale eyebrow"),
      text("saleTitle", "Sale title"),
      textarea("saleText", "Sale text"),
      text("saleBadge", "Badge (e.g. “Up to 25% off”)"),
      text("saleButtonLabel", "Sale button label"),
      url("saleHref", "Sale button link"),
      image("saleImage", "Sale image"),
      text("couponEyebrow", "Coupon eyebrow"),
      text("couponCode", "Coupon code"),
      text("couponTitle", "Coupon title"),
      textarea("couponText", "Coupon text"),
      text("dealEyebrow", "Deal-of-the-day eyebrow"),
      text("dealNote", "Deal countdown note"),
      text("dealButtonLabel", "Deal button label"),
      image("dealFallbackImage", "Deal image (when no product is on offer)"),
    ],
    default: {
      saleEyebrow: "Limited time offer",
      saleTitle: "The festive edit is live",
      saleText: "Up to 25% off hand-picked gifts, décor and keepsakes — while they last.",
      saleBadge: "Up to 25% off",
      saleButtonLabel: "Explore deals",
      saleHref: "/shop?tag=clearance",
      saleImage: "/editorial/scene-flatlay.webp",
      couponEyebrow: "Exclusive for you",
      couponCode: "WELCOME10",
      couponTitle: "10% off your first order",
      couponText: "Use this code at checkout on your first Suthrayaa order.",
      dealEyebrow: "Deal of the day",
      dealNote: "Hurry — ends at midnight",
      dealButtonLabel: "Shop the deal",
      dealFallbackImage: "/editorial/scene-star.webp",
    },
  },
  {
    key: "home.story",
    group: "Homepage",
    label: "Our story (homepage)",
    description: "The brand story block with two images and stats. Also shown on the About page.",
    previewPath: "/",
    fields: [
      text("eyebrow", "Eyebrow"),
      text("title", "Title", HEADING_HELP),
      list("paragraphs", "Paragraphs", "Paragraph", [textarea("text", "Text")], 6),
      image("image", "Main image"),
      text("imageAlt", "Main image description (alt text)"),
      image("secondaryImage", "Small image"),
      text("badgeValue", "Floating badge value"),
      text("badgeLabel", "Floating badge label"),
      list("stats", "Stats", "Stat", [text("value", "Value"), text("label", "Label")], 4),
      text("ctaLabel", "Button label"),
      url("ctaHref", "Button link"),
    ],
    default: {
      eyebrow: "Our story",
      title: "Every stitch *tells a story*",
      paragraphs: [
        { text: "Suthrayaa was born from a passion for the timeless art of crochet. What started as a hobby has blossomed into a mission to bring handcrafted joy to homes across India." },
        { text: "The name \"Suthrayaa\" comes from the Sanskrit word for thread — the beautiful threads that connect us all. Every piece is made to order with premium, eco-friendly yarn, so it's crafted specially for you." },
      ],
      image: "/editorial/story-hands.webp",
      imageAlt: "Hands crocheting in the Suthrayaa studio",
      secondaryImage: "/editorial/scene-hair.webp",
      badgeValue: "100%",
      badgeLabel: "Handmade",
      stats: [
        { value: "2+", label: "Years of craft" },
        { value: "1000+", label: "Pieces created" },
        { value: "50+", label: "Unique designs" },
      ],
      ctaLabel: "Read our full story",
      ctaHref: "/about",
    },
  },
  {
    key: "home.reels",
    group: "Homepage",
    label: "Reels",
    description: "Short vertical video clips. Section heading is set in Site Settings → Homepage.",
    previewPath: "/",
    fields: [
      list(
        "items",
        "Reels",
        "Reel",
        [
          text("title", "Title"),
          text("tag", "Tag"),
          url("href", "Link"),
          { name: "videoUrl", label: "Video (MP4)", type: "video", help: "A short 9:16 MP4 — paste a URL (e.g. a Supabase Storage public link)." },
          { name: "videoWebmUrl", label: "Video (WebM, optional)", type: "video" },
          image("poster", "Poster image"),
        ],
        12
      ),
    ],
    default: {
      items: [
        { title: "Devghar garlands", tag: "Pooja", href: "/shop?category=devghar-collection-v2", videoUrl: "/reels/devghar.mp4", videoWebmUrl: "/reels/devghar.webm", poster: "/reels/devghar.webp" },
        { title: "Door torans", tag: "Home décor", href: "/shop?search=toran", videoUrl: "/reels/torans.mp4", videoWebmUrl: "/reels/torans.webm", poster: "/reels/torans.webp" },
        { title: "Star → bottle holder", tag: "2-in-1", href: "/shop?search=bottle", videoUrl: "/reels/bottle.mp4", videoWebmUrl: "/reels/bottle.webm", poster: "/reels/bottle.webp" },
        { title: "Forever flowers", tag: "Flowers", href: "/shop?category=flowers-floral", videoUrl: "/reels/flowers.mp4", videoWebmUrl: "/reels/flowers.webm", poster: "/reels/flowers.webp" },
        { title: "Gajra & hairbands", tag: "Hair", href: "/shop?search=hair", videoUrl: "/reels/hair.mp4", videoWebmUrl: "/reels/hair.webm", poster: "/reels/hair.webp" },
        { title: "Keychains & totes", tag: "Gifts", href: "/shop?search=keychain", videoUrl: "/reels/gifts.mp4", videoWebmUrl: "/reels/gifts.webm", poster: "/reels/gifts.webp" },
        { title: "Coasters & mats", tag: "Table", href: "/shop?search=coaster", videoUrl: "/reels/home.mp4", videoWebmUrl: "/reels/home.webm", poster: "/reels/home.webp" },
      ],
    },
  },
  {
    key: "home.convertible",
    group: "Homepage",
    label: "Feature showcase (2-in-1)",
    description: "The animated product showcase that alternates between images.",
    previewPath: "/",
    fields: [
      text("eyebrow", "Eyebrow"),
      text("title", "Title", HEADING_HELP),
      textarea("text", "Text"),
      list("stages", "Frames", "Frame", [image("image", "Image"), text("label", "Label"), text("note", "Caption")], 4),
      text("ctaLabel", "Button label"),
      url("ctaHref", "Button link"),
    ],
    default: {
      eyebrow: "Two pieces in one",
      title: "A star that *opens into* a bottle holder.",
      text: "Our convertible mini bag hanging folds into a cheerful crochet star. Open it up and the net stretches around your water bottle, with the star as a sturdy base.",
      stages: [
        { image: "/editorial/scene-staropen.webp", label: "Mini bag hanging", note: "Hang it on a hook, a bag strap or your doorway." },
        { image: "/editorial/scene-bottleopen.webp", label: "Bottle holder", note: "Open the star and the net slips over any bottle." },
      ],
      ctaLabel: "Shop the bottle holder",
      ctaHref: "/shop?search=bottle",
    },
  },
  {
    key: "home.instagram",
    group: "Homepage",
    label: "Instagram gallery",
    description: "The photo grid linking to Instagram. Section heading is set in Site Settings → Homepage.",
    previewPath: "/",
    fields: [
      url("profileUrl", "Instagram profile URL"),
      text("buttonLabel", "Button label"),
      list("images", "Photos", "Photo", [image("image", "Image"), text("alt", "Description (alt text)")], 12),
    ],
    default: {
      profileUrl: "https://instagram.com/suthrayaa",
      buttonLabel: "Follow @suthrayaa",
      images: [
        { image: "/editorial/scene-garland.webp", alt: "Crochet marigold garland" },
        { image: "/editorial/scene-keychains.webp", alt: "Crochet keychains" },
        { image: "/editorial/scene-doily.webp", alt: "Peacock crochet doily" },
        { image: "/editorial/scene-mobile.webp", alt: "Star and moon mobile" },
        { image: "/editorial/scene-bags.webp", alt: "Crochet phone sling bags" },
        { image: "/editorial/scene-toran.webp", alt: "Peacock feather toran" },
      ],
    },
  },
  {
    key: "home.testimonials",
    group: "Homepage",
    label: "Testimonials block",
    description: "Supporting text around the testimonial carousel. Quotes themselves are managed in Admin → Testimonials; the heading in Site Settings → Homepage.",
    previewPath: "/#testimonials",
    fields: [text("ratingCaption", "Rating caption")],
    default: { ratingCaption: "Average from happy customers" },
  },

  // ---------------------------------------------------------------- Pages
  {
    key: "page.about",
    group: "Pages",
    label: "About page",
    description: "The Our Story page (the story block itself is shared with the homepage).",
    previewPath: "/about",
    fields: [
      text("eyebrow", "Eyebrow"),
      text("title", "Title"),
      textarea("description", "Intro"),
      image("heroImage", "Header image"),
      text("processEyebrow", "Process eyebrow"),
      text("processTitle", "Process title", HEADING_HELP),
      textarea("processDescription", "Process intro"),
      list("steps", "Process steps", "Step", [icon("icon"), text("title", "Title"), textarea("description", "Description")], 8),
      text("ctaTitle", "Call-to-action title"),
      text("ctaLabel", "Call-to-action button"),
      url("ctaHref", "Call-to-action link"),
    ],
    default: {
      eyebrow: "Our Story",
      title: "Telling Stories Through Yarn",
      description: "Suthrayaa is a small studio with a simple belief: handmade things carry more heart than anything mass-produced ever could.",
      heroImage: "/editorial/story-hands.webp",
      processEyebrow: "Behind the yarn",
      processTitle: "From skein *to doorstep*",
      processDescription: "Here's what happens between the moment you place an order and the moment it arrives at your door.",
      steps: [
        { icon: "sparkles", title: "Design", description: "Every piece starts as a sketch, inspired by color, texture, and the little details that make handmade special." },
        { icon: "heart", title: "Craft", description: "Our artisans hand-crochet each item, stitch by stitch, using premium cotton yarn — no machines involved." },
        { icon: "users", title: "Check", description: "Every finished piece is inspected for quality before it’s wrapped and readied for your doorstep." },
        { icon: "award", title: "Deliver", description: "Packed with care and a little bit of love, your handmade piece begins its journey to you." },
      ],
      ctaTitle: "Ready to find a piece that tells your story?",
      ctaLabel: "Explore the Collection",
      ctaHref: "/shop",
    },
  },
  {
    key: "page.faqs",
    group: "Pages",
    label: "FAQs page",
    description: "Frequently asked questions, grouped by topic.",
    previewPath: "/faqs",
    fields: [
      text("eyebrow", "Eyebrow"),
      text("title", "Title"),
      textarea("description", "Intro"),
      list(
        "groups",
        "Topics",
        "Topic",
        [text("title", "Topic name"), list("items", "Questions", "Question", [text("question", "Question"), { name: "answer", label: "Answer", type: "markdown" }], 30)],
        12
      ),
    ],
    default: {
      eyebrow: "Support",
      title: "Frequently Asked Questions",
      description: "Can't find what you're looking for? Reach out on our Contact page and we'll help personally.",
      groups: [
        {
          title: "Ordering & Customization",
          items: [
            { question: "How long does it take to make my order?", answer: "Since each piece is handmade to order, it typically takes 3–5 business days to craft your item. Customized items may take an additional 1–2 days." },
            { question: "Can I customize color and size together?", answer: "Yes — many products let you choose both a color and a size (or other options) independently. Available choices are shown right on the product page; if a product only offers certain combinations, that’ll be clear before you add it to your cart." },
            { question: "What if I want to change my customization after ordering?", answer: "Contact us within 24 hours of placing your order to make changes. After that, we may have already started crafting your piece." },
            { question: "Is gift wrapping available?", answer: "Yes! We offer beautiful handmade gift wrapping at checkout, along with the option to add a personalized note." },
          ],
        },
        {
          title: "Shipping & Delivery",
          items: [
            { question: "How much does shipping cost?", answer: "Shipping is free on all prepaid orders above Rs. 999. Below that, a flat shipping fee (Rs. 49 standard, Rs. 99 express) applies and is shown at checkout." },
            { question: "Do you ship internationally?", answer: "Not yet — we currently ship within India only. Sign up for our newsletter to hear when that changes." },
            { question: "How can I track my order?", answer: "You’ll get a tracking link by email and SMS as soon as your order ships. You can also check status any time from [your orders page](/account/orders)." },
          ],
        },
        {
          title: "Returns & Payments",
          items: [
            { question: "What is your return policy?", answer: "Ready-to-ship items can be returned within 7 days of delivery if unused and in original packaging. Personalized and made-to-order pieces are final sale unless damaged or defective. See our [Returns & Refunds](/returns) page for full details." },
            { question: "What payment methods do you accept?", answer: "We accept Cash on Delivery, and online payments via UPI, cards, netbanking, and wallets through Razorpay." },
            { question: "Is it safe to pay online?", answer: "Yes — all online payments are processed securely by Razorpay over an encrypted connection. We never store your card details." },
          ],
        },
      ],
    },
  },
  {
    key: "page.contact",
    group: "Pages",
    label: "Contact page",
    description: "Page text. Email, phone, WhatsApp and hours come from Site Settings → Contact & Business.",
    previewPath: "/contact",
    fields: [text("eyebrow", "Eyebrow"), text("title", "Title"), textarea("description", "Intro"), text("studioLabel", "Address label")],
    default: {
      eyebrow: "We'd Love to Hear From You",
      title: "Get in Touch",
      description: "Questions about an order, a custom piece in mind, or just want to say hi? We're one message away.",
      studioLabel: "Studio",
    },
  },

  // ---------------------------------------------------------------- Policies
  policyBlock("policy.shipping", "Shipping Info", "/shipping", {
    ...POLICY_DEFAULTS.shipping,
    highlights: [
      { icon: "clock", title: "3–5 Day Crafting", description: "Most pieces are made to order, so we craft before we ship." },
      { icon: "truck", title: "Free Shipping", description: "On all prepaid orders above Rs. 999, pan-India." },
      { icon: "map-pin", title: "Pan-India Delivery", description: "We ship to every serviceable pincode across India." },
      { icon: "package-check", title: "Tracked Shipments", description: "A tracking link is emailed the moment your order ships." },
    ],
  }),
  policyBlock("policy.returns", "Returns & Refunds", "/returns", POLICY_DEFAULTS.returns),
  policyBlock("policy.refund", "Refund Policy", "/refund-policy", POLICY_DEFAULTS["refund-policy"]),
  policyBlock("policy.privacy", "Privacy Policy", "/privacy", POLICY_DEFAULTS.privacy),
  policyBlock("policy.terms", "Terms & Conditions", "/terms", POLICY_DEFAULTS.terms),

  // ---------------------------------------------------------------- Site-wide
  {
    key: "site.chrome",
    group: "Site-wide",
    label: "Header perks & page images",
    description:
      "The rotating perks strip at the top of every page (shown when no announcement is live — announcements are in Site Settings → Header), plus the editorial images on the sign-in page, shop banner and category mega-menu.",
    previewPath: "/",
    fields: [
      list("perks", "Header perks", "Perk", [icon("icon"), text("text", "Text")], 8),
      image("megaMenuImage", "Category menu image"),
      image("shopBannerImage", "Shop page banner image"),
      image("authImage", "Sign-in page image"),
    ],
    default: {
      perks: [
        { icon: "truck", text: "Free shipping on orders over ₹999" },
        { icon: "rotate-ccw", text: "Easy 7-day returns" },
        { icon: "shield-check", text: "Secure & safe payments" },
        { icon: "sparkles", text: "Handmade to order in India" },
      ],
      megaMenuImage: "/editorial/scene-sunflowers.webp",
      shopBannerImage: "/editorial/scene-flatlay.webp",
      authImage: "/editorial/scene-devghar.webp",
    },
  },

  // ---------------------------------------------------------------- Footer
  {
    key: "footer.content",
    group: "Footer",
    label: "Footer extras",
    description: "The promise strip above the footer, the newsletter card and the payment-method chips. Links, logo, description and copyright are in Site Settings → Footer.",
    previewPath: "/",
    fields: [
      list("promises", "Promise strip", "Promise", [icon("icon"), text("title", "Title"), text("text", "Text")], 6),
      text("newsletterTitle", "Newsletter title"),
      textarea("newsletterText", "Newsletter text"),
      text("newsletterSuccess", "Newsletter success message"),
      list("paymentMethods", "“We accept” chips", "Method", [text("label", "Label")], 10),
    ],
    default: {
      promises: [
        { icon: "award", title: "Quality you can trust", text: "Premium cotton yarn, finished by hand." },
        { icon: "headphones", title: "Real human support", text: "We reply within a day, every day." },
        { icon: "heart", title: "Loved by thousands", text: "500+ happy customers across India." },
        { icon: "leaf", title: "Slow & sustainable", text: "Made to order — no waste, no mass stock." },
      ],
      newsletterTitle: "Join the Suthrayaa circle",
      newsletterText: "New drops, maker stories and member-only offers — straight from our studio to your inbox. Get 10% off your first order.",
      newsletterSuccess: "You're on the list! Welcome to the yarn family.",
      paymentMethods: [{ label: "UPI" }, { label: "Visa" }, { label: "Mastercard" }, { label: "RuPay" }, { label: "Net Banking" }],
    },
  },
];

// The shipping page also has a highlight-card row
const shippingBlock = CONTENT_BLOCKS.find((b) => b.key === "policy.shipping")!;
shippingBlock.fields.splice(3, 0, list("highlights", "Highlight cards", "Card", [icon("icon"), text("title", "Title"), text("description", "Description")], 6));

export const CONTENT_BLOCKS_BY_KEY = new Map(CONTENT_BLOCKS.map((b) => [b.key, b]));

// ---------------------------------------------------------------- validation

function fieldSchema(f: ContentField): ZodTypeAny {
  switch (f.type) {
    case "list": {
      const shape = Object.fromEntries((f.fields ?? []).map((sub) => [sub.name, fieldSchema(sub)]));
      return z.array(z.object(shape)).max(f.max ?? 50).default([]);
    }
    case "markdown":
      return z.string().max(20_000).default("");
    case "icon":
      return z.string().max(40).default("");
    default:
      return z.string().max(2_000).default("");
  }
}

/** zod schema for a block's value — unknown keys are stripped, missing strings default to "". */
export function blockSchema(block: ContentBlock) {
  return z.object(Object.fromEntries(block.fields.map((f) => [f.name, fieldSchema(f)])));
}
