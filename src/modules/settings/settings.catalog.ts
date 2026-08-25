// Single source of truth for every site setting: its group (for the admin UI + RBAC),
// type (for validation), default (India-first, per the plan's "changes nothing until an
// admin opts in" rule), and whether it's safe to expose on the public API. The site_settings
// table just stores {key -> value}; everything else about a key lives here, mirroring how
// permissions.catalog.ts is the source of truth for RBAC permissions.

export type SettingType = "string" | "text" | "number" | "boolean" | "select" | "color" | "url" | "email";

export interface SettingDef {
  key: string;
  group: string;
  label: string;
  type: SettingType;
  default: string | number | boolean | null;
  isPublic: boolean;
  isSensitive: boolean;
  options?: string[];
}

function def(
  key: string,
  group: string,
  label: string,
  type: SettingType,
  defaultValue: string | number | boolean | null,
  opts: Partial<Pick<SettingDef, "isPublic" | "isSensitive" | "options">> = {}
): SettingDef {
  return { key, group, label, type, default: defaultValue, isPublic: opts.isPublic ?? true, isSensitive: opts.isSensitive ?? false, options: opts.options };
}

export const SETTINGS: SettingDef[] = [
  // ---- General ----
  def("store.name", "general", "Store Name", "string", "Suthrayaa"),
  def("store.tagline", "general", "Store Tagline", "string", "Handcrafted with love"),
  def("store.description", "general", "Store Description", "text", "Premium crochet yarn, kits, and craft supplies, handmade in small batches across India."),
  def("store.email", "general", "Store Email", "email", "suthrayaa@gmail.com"),
  def("store.support_email", "general", "Support Email", "email", "suthrayaa@gmail.com"),
  def("store.support_phone", "general", "Customer Support Phone", "string", ""),
  def("store.whatsapp_number", "general", "WhatsApp Number", "string", ""),
  def("store.country", "general", "Country", "string", "India"),
  def("store.country_code", "general", "Country Code", "string", "IN"),
  def("store.currency", "general", "Currency", "string", "INR"),
  def("store.currency_symbol", "general", "Currency Symbol", "string", "₹"),
  def("store.currency_position", "general", "Currency Symbol Position", "select", "before", { options: ["before", "after"] }),
  def("store.decimal_places", "general", "Price Decimal Places", "select", "0", { options: ["0", "2"] }),
  def("store.timezone", "general", "Timezone", "string", "Asia/Kolkata"),
  def("store.locale", "general", "Locale", "string", "en-IN"),
  def("store.date_format", "general", "Date Format", "select", "DD/MM/YYYY", { options: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] }),
  def("store.weight_unit", "general", "Weight Unit", "select", "g", { options: ["g", "kg"] }),
  def("store.dimension_unit", "general", "Dimension Unit", "select", "cm", { options: ["cm", "in"] }),

  // ---- Branding (permission: settings.branding) ----
  def("branding.logo_url", "branding", "Logo", "url", ""),
  def("branding.logo_light_url", "branding", "Light Logo", "url", ""),
  def("branding.logo_dark_url", "branding", "Dark Logo", "url", ""),
  def("branding.logo_mobile_url", "branding", "Mobile Logo", "url", ""),
  def("branding.favicon_url", "branding", "Favicon", "url", ""),
  def("branding.store_icon_url", "branding", "Store Icon", "url", ""),
  def("branding.default_product_image_url", "branding", "Default Product Image", "url", ""),
  def("branding.default_avatar_url", "branding", "Default Customer Avatar", "url", ""),
  def("branding.color_primary", "branding", "Primary Color", "color", "#c1502e"),
  def("branding.color_secondary", "branding", "Secondary Color", "color", "#7c9473"),
  def("branding.color_accent", "branding", "Accent Color", "color", "#d8a13b"),
  def("branding.color_background", "branding", "Background Color", "color", "#fbf6ee"),
  def("branding.color_text", "branding", "Text Color", "color", "#3a2a1f"),
  def("branding.color_success", "branding", "Success Color", "color", "#2fdc84"),
  def("branding.color_error", "branding", "Error Color", "color", "#d64545"),

  // ---- Storefront (permission: settings.storefront) ----
  def("storefront.guest_checkout", "storefront", "Guest Checkout", "boolean", true),
  def("storefront.customer_registration", "storefront", "Customer Registration", "boolean", true),
  def("storefront.wishlist", "storefront", "Wishlist", "boolean", true),
  def("storefront.reviews", "storefront", "Product Reviews", "boolean", true),
  def("storefront.ratings", "storefront", "Product Ratings", "boolean", true),
  def("storefront.comparison", "storefront", "Product Comparison", "boolean", false),
  def("storefront.show_stock_quantity", "storefront", "Show Stock Quantity", "boolean", false),
  def("storefront.show_sku", "storefront", "Show SKU", "boolean", false),
  def("storefront.show_weight", "storefront", "Show Product Weight", "boolean", false),
  def("storefront.show_dimensions", "storefront", "Show Product Dimensions", "boolean", false),
  def("storefront.show_out_of_stock", "storefront", "Show Out-of-Stock Products", "boolean", true),
  def("storefront.products_per_page", "storefront", "Products Per Page", "number", 24),
  def("storefront.default_sort", "storefront", "Default Product Sort", "select", "newest", { options: ["newest", "price_asc", "price_desc", "bestselling"] }),

  // ---- Header & Announcement (permission: settings.storefront) ----
  def("header.announcement_enabled", "header", "Announcement Enabled", "boolean", false),
  def("header.announcement_text", "header", "Announcement Text", "string", "Free shipping across India on orders above ₹999"),
  def("header.announcement_link", "header", "Announcement Link", "url", ""),
  def("header.announcement_start_date", "header", "Announcement Start Date", "string", ""),
  def("header.announcement_end_date", "header", "Announcement End Date", "string", ""),
  def("header.announcement_sticky", "header", "Sticky Announcement", "boolean", false),

  // ---- Footer (permission: settings.storefront) ----
  def("footer.description", "footer", "Footer Description", "text", ""),
  def("footer.logo_url", "footer", "Footer Logo", "url", ""),
  def("footer.copyright_text", "footer", "Copyright Text", "string", "© Suthrayaa. All rights reserved."),
  def("footer.newsletter_enabled", "footer", "Newsletter Signup", "boolean", true),

  // ---- Contact & Business (public — displayed on the storefront) ----
  def("contact.business_email", "contact", "Business Email", "email", ""),
  def("contact.support_email", "contact", "Support Email", "email", ""),
  def("contact.phone", "contact", "Phone", "string", ""),
  def("contact.whatsapp", "contact", "WhatsApp", "string", ""),
  def("contact.support_hours", "contact", "Customer Support Hours", "string", "Monday - Saturday, 10:00 AM - 7:00 PM IST"),
  def("contact.business_hours", "contact", "Business Hours", "string", "Monday - Saturday, 10:00 AM - 7:00 PM IST"),

  // ---- Business Information (Super Admin only — GST/PAN adjacent, kept private) ----
  def("business.legal_name", "business", "Legal Business Name", "string", "", { isPublic: false }),
  def("business.address_line1", "business", "Address Line 1", "string", "", { isPublic: false }),
  def("business.address_line2", "business", "Address Line 2", "string", "", { isPublic: false }),
  def("business.city", "business", "City", "string", "", { isPublic: false }),
  def("business.district", "business", "District", "string", "", { isPublic: false }),
  def("business.state", "business", "State", "string", "", { isPublic: false }),
  def("business.pincode", "business", "PIN Code", "string", "", { isPublic: false }),
  def("business.gst_state", "business", "GST Registration State", "string", "", { isPublic: false }),

  // ---- Social Media ----
  def("social.instagram_url", "social", "Instagram URL", "url", ""),
  def("social.instagram_enabled", "social", "Instagram Enabled", "boolean", false),
  def("social.facebook_url", "social", "Facebook URL", "url", ""),
  def("social.facebook_enabled", "social", "Facebook Enabled", "boolean", false),
  def("social.pinterest_url", "social", "Pinterest URL", "url", ""),
  def("social.pinterest_enabled", "social", "Pinterest Enabled", "boolean", false),
  def("social.youtube_url", "social", "YouTube URL", "url", ""),
  def("social.youtube_enabled", "social", "YouTube Enabled", "boolean", false),
  def("social.tiktok_url", "social", "TikTok URL", "url", ""),
  def("social.tiktok_enabled", "social", "TikTok Enabled", "boolean", false),
  def("social.whatsapp_number", "social", "WhatsApp Number", "string", ""),
  def("social.whatsapp_enabled", "social", "WhatsApp Enabled", "boolean", false),

  // ---- SEO ----
  def("seo.site_title", "seo", "Site Title", "string", "Suthrayaa | Crochet Yarn, Kits & Craft Supplies in India"),
  def("seo.meta_description", "seo", "Meta Description", "text", "Shop premium crochet yarn, kits, hooks, and craft supplies — handmade in small batches and shipped across India."),
  def("seo.canonical_url", "seo", "Canonical URL", "url", ""),
  def("seo.default_og_image", "seo", "Default OG Image", "url", ""),
  def("seo.robots", "seo", "Robots", "string", "index, follow"),

  // ---- GST & Tax (permission: settings.tax, private) ----
  def("tax.gst_enabled", "tax", "GST Enabled", "boolean", false, { isPublic: false }),
  def("tax.prices_include_gst", "tax", "Prices Include GST", "boolean", true, { isPublic: false }),
  def("tax.default_tax_category_id", "tax", "Default GST Rate", "string", "", { isPublic: false }),
  def("tax.tax_label", "tax", "Tax Label", "string", "GST", { isPublic: false }),
  def("tax.tax_invoice_enabled", "tax", "Tax Invoice Enabled", "boolean", true, { isPublic: false }),

  // ---- Payments (permission: settings.payment, private) ----
  def("payment.razorpay_enabled", "payment", "Razorpay Enabled", "boolean", true, { isPublic: false }),
  def("payment.cod_enabled", "payment", "Cash on Delivery Enabled", "boolean", true, { isPublic: false }),
  def("payment.cod_min_amount", "payment", "COD Minimum Order Amount", "number", 0, { isPublic: false }),
  def("payment.cod_max_amount", "payment", "COD Maximum Order Amount", "number", 5000, { isPublic: false }),
  def("payment.cod_fee", "payment", "COD Fee", "number", 0, { isPublic: false }),
  def("payment.upi_enabled", "payment", "UPI Enabled", "boolean", true, { isPublic: false }),
  def("payment.upi_manual_id", "payment", "Manual UPI ID", "string", "", { isPublic: false }),
  def("payment.upi_display_name", "payment", "UPI Display Name", "string", "", { isPublic: false }),

  // ---- Shipping (permission: settings.shipping) ----
  // Defaults reproduce today's hardcoded checkout.service.ts constants exactly (standard
  // ₹60, express +₹90 = ₹150, free above ₹999, ₹49 gift wrap) so enabling this module
  // changes nothing until an admin actually edits a value.
  def("shipping.enabled", "shipping", "Shipping Enabled", "boolean", true),
  def("shipping.free_shipping_enabled", "shipping", "Free Shipping Enabled", "boolean", true),
  def("shipping.free_shipping_threshold", "shipping", "Free Shipping Threshold", "number", 999),
  def("shipping.default_fee", "shipping", "Default Shipping Fee", "number", 60),
  def("shipping.express_surcharge", "shipping", "Express Shipping Surcharge", "number", 90),
  def("shipping.gift_wrap_fee", "shipping", "Gift Wrap Fee", "number", 49),

  // ---- Orders ----
  def("order.number_prefix", "orders", "Order Number Prefix", "string", "ORD", { isPublic: false }),
  def("order.min_amount", "orders", "Minimum Order Amount", "number", 0, { isPublic: false }),
  def("order.max_amount", "orders", "Maximum Order Amount", "number", 0, { isPublic: false }),
  def("order.allow_cancellation", "orders", "Allow Order Cancellation", "boolean", true, { isPublic: false }),
  def("order.cancellation_window_days", "orders", "Cancellation Window (days)", "number", 1, { isPublic: false }),
  def("order.allow_returns", "orders", "Allow Customer Returns", "boolean", true),
  def("order.return_window_days", "orders", "Return Window (days)", "number", 7),
  def("order.refund_enabled", "orders", "Refunds Enabled", "boolean", true, { isPublic: false }),
  def("order.delivery_message", "orders", "Expected Delivery Message", "string", "Orders are usually delivered within 3–7 business days across India."),

  // ---- Inventory (private — operational) ----
  def("inventory.tracking_enabled", "inventory", "Inventory Tracking", "boolean", true, { isPublic: false }),
  def("inventory.low_stock_threshold", "inventory", "Low Stock Threshold", "number", 5, { isPublic: false }),
  def("inventory.allow_backorders", "inventory", "Allow Backorders", "boolean", false, { isPublic: false }),
  def("inventory.reserve_during_checkout", "inventory", "Reserve Inventory During Checkout", "boolean", false, { isPublic: false }),

  // ---- Notifications (admin alerts, private) ----
  def("notify.new_order", "notifications", "New Order Alert", "boolean", true, { isPublic: false }),
  def("notify.low_stock", "notifications", "Low Stock Alert", "boolean", true, { isPublic: false }),
  def("notify.new_customer", "notifications", "New Customer Alert", "boolean", false, { isPublic: false }),
  def("notify.new_review", "notifications", "New Review Alert", "boolean", true, { isPublic: false }),
  def("notify.failed_payment", "notifications", "Failed Payment Alert", "boolean", true, { isPublic: false }),
  def("notify.refund", "notifications", "Refund Alert", "boolean", true, { isPublic: false }),

  // ---- Email (permission: settings.email, private — no secrets, sender identity only) ----
  def("email.sender_name", "email", "Sender Name", "string", "Suthrayaa", { isPublic: false }),
  def("email.sender_email", "email", "Sender Email", "email", "", { isPublic: false }),
  def("email.reply_to", "email", "Reply-To Email", "email", "", { isPublic: false }),

  // ---- Maintenance (permission: settings.maintenance) ----
  def("maintenance.enabled", "maintenance", "Maintenance Mode", "boolean", false),
  def("maintenance.title", "maintenance", "Maintenance Title", "string", "We're upgrading Suthrayaa"),
  def("maintenance.message", "maintenance", "Maintenance Message", "text", "We'll be back shortly."),
  def("maintenance.image_url", "maintenance", "Maintenance Image", "url", ""),
  def("maintenance.expected_return", "maintenance", "Expected Return Time", "string", ""),

  // ---- Analytics (permission: settings.analytics — IDs only, never raw scripts) ----
  def("analytics.ga_measurement_id", "analytics", "Google Analytics Measurement ID", "string", "", { isPublic: false }),
  def("analytics.gtm_id", "analytics", "Google Tag Manager ID", "string", "", { isPublic: false }),
  def("analytics.meta_pixel_id", "analytics", "Meta Pixel ID", "string", "", { isPublic: false }),

  // ---- Legal ----
  def("legal.privacy_url", "legal", "Privacy Policy URL", "url", "/privacy"),
  def("legal.terms_url", "legal", "Terms & Conditions URL", "url", "/terms"),
  def("legal.shipping_policy_url", "legal", "Shipping Policy URL", "url", "/shipping"),
  def("legal.return_policy_url", "legal", "Return Policy URL", "url", "/returns"),
  def("legal.refund_policy_url", "legal", "Refund Policy URL", "url", "/refund-policy"),
  def("legal.cookie_consent_enabled", "legal", "Cookie Consent Banner", "boolean", false),
  def("legal.cookie_message", "legal", "Cookie Consent Message", "text", "We use cookies to improve your experience on Suthrayaa."),
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
export const SETTING_KEYS = new Set(SETTINGS.map((s) => s.key));

export function groupKeys(group: string): string[] {
  return SETTINGS.filter((s) => s.group === group).map((s) => s.key);
}

// Groups that require an additional settings.<group> permission beyond the baseline
// settings.view/settings.update — matches the RBAC plan's narrow-by-default grants.
export const SENSITIVE_GROUP_PERMISSION: Record<string, string> = {
  branding: "settings.branding",
  storefront: "settings.storefront",
  header: "settings.storefront",
  footer: "settings.storefront",
  tax: "settings.tax",
  shipping: "settings.shipping",
  payment: "settings.payment",
  email: "settings.email",
  maintenance: "settings.maintenance",
  analytics: "settings.analytics",
};
