// Postgres is snake_case; the API (and the existing frontend) speaks camelCase.
// Keeping these mappings in one place is what lets lib/data.ts be swapped for a
// live fetch without touching every call site.

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toCategoryDTO(row: any, productCount = 0) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    image: row.image_url ?? "",
    productCount,
    parentId: row.parent_id ?? null,
    isDummy: row.description === "Planned — not yet in production",
    showInNavigation: row.show_in_navigation ?? true,
    showOnHomepage: row.show_on_homepage ?? false,
    isFeatured: row.is_featured ?? false,
    seoTitle: row.seo_title ?? undefined,
    seoDescription: row.seo_description ?? undefined,
  };
}

/**
 * The one true "what does this product actually cost right now" — used for both display
 * (storefront price/badge) and checkout math, so a shown price can never diverge from what
 * gets charged. A sale only applies while active: price set, lower than the regular price,
 * and (if dates are set) the current time falls inside them.
 */
export function getEffectivePrice(row: any): number {
  const regular = Number(row.price);
  const sale = row.sale_price != null ? Number(row.sale_price) : null;
  if (sale == null || !(sale < regular)) return regular;

  const now = Date.now();
  if (row.sale_start_date && now < new Date(row.sale_start_date).getTime()) return regular;
  if (row.sale_end_date && now > new Date(row.sale_end_date).getTime()) return regular;
  return sale;
}

export function toColorDTO(row: any) {
  return { id: row.id, name: row.name, hex: row.hex };
}

export function toTestimonialDTO(row: any) {
  return {
    id: row.id,
    customerName: row.customer_name,
    location: row.location ?? "",
    content: row.content,
    rating: row.rating,
    avatar: row.avatar_url ?? undefined,
    productPurchased: row.product_purchased ?? undefined,
  };
}

export function toHeroSlideDTO(row: any) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    description: row.description ?? undefined,
    image: row.image_url ?? undefined,
    ctaLabel: row.cta_label ?? undefined,
    ctaHref: row.cta_href ?? undefined,
    accentToken: row.accent_token ?? undefined,
  };
}

export function toReviewDTO(row: any) {
  return {
    id: row.id,
    productId: row.product_id,
    customerName: row.customer_name,
    rating: row.rating,
    title: row.title ?? "",
    content: row.content,
    date: row.created_at,
    verified: row.is_verified_purchase,
    images: row.images ?? [],
  };
}

/** Builds the customizationOptions object, or undefined when the product isn't customizable. */
function toCustomizationOptionsDTO(rule: any) {
  if (!rule || !rule.is_customizable) return undefined;

  const allowedColorHexes: string[] =
    (rule.customization_allowed_colors ?? [])
      .map((r: any) => r.colors?.hex)
      .filter(Boolean);

  return {
    allowText: rule.allow_text,
    maxTextLength: rule.max_text_length ?? undefined,
    textPlaceholder: rule.text_placeholder ?? undefined,
    allowColorChoice: rule.allow_color_choice,
    isLimitedEdition: rule.is_limited_edition,
    // Empty = "any of the product's base colors are fair game" (see admin customization docs).
    allowedColors: allowedColorHexes,
  };
}

/** Maps a product_customizations row (with nested customization_values) to the API shape. */
function toProductCustomizationDTO(row: any, includeDisabled: boolean) {
  const values = (row.customization_values ?? [])
    .filter((v: any) => includeDisabled || v.enabled)
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((v: any) => ({
      id: v.id,
      label: v.label,
      value: v.value,
      priceAdjustment: Number(v.price_adjustment ?? 0),
      enabled: v.enabled,
      sku: v.sku ?? undefined,
    }));

  return {
    id: row.id,
    name: row.name,
    label: row.label,
    type: row.type,
    required: row.required,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    maxLength: row.max_length ?? undefined,
    placeholder: row.placeholder ?? undefined,
    defaultValue: row.default_value ?? undefined,
    conditionalParentValueId: row.conditional_parent_value_id ?? undefined,
    values,
  };
}

/** Builds the sorted, customer-safe list of customization groups for a product. */
function toProductCustomizationsList(rows: any[], includeDisabled: boolean) {
  return rows
    .filter((r) => includeDisabled || r.enabled)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((r) => toProductCustomizationDTO(r, includeDisabled));
}

export function toProductDTO(row: any, opts: { includeDisabledCustomizations?: boolean; admin?: boolean } = {}) {
  const images = (row.product_images ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((i: any) => i.url);

  const colors = (row.product_colors ?? [])
    .slice()
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((pc: any) => pc.colors?.hex)
    .filter(Boolean);

  const customizations = toProductCustomizationsList(
    row.product_customizations ?? [],
    Boolean(opts.includeDisabledCustomizations)
  );

  // "From ₹X" pricing on listing cards: the true minimum a customer could pay — base
  // price plus each REQUIRED group's cheapest value (optional groups don't force any
  // increase, since skipping them is always allowed). Only surfaced when price can
  // actually vary, so a plain non-customizable product just shows its normal price.
  const fromPriceAdjustment = customizations
    .filter((c: any) => c.required && c.values.length > 0)
    .reduce((sum: number, c: any) => sum + Math.min(...c.values.map((v: any) => v.priceAdjustment)), 0);
  const hasVariablePricing = customizations.some((c: any) => c.values.some((v: any) => v.priceAdjustment !== 0));

  const effectivePrice = getEffectivePrice(row);
  const onSale = effectivePrice < Number(row.price);
  const discountPercent = onSale ? Math.round((1 - effectivePrice / Number(row.price)) * 100) : undefined;

  const base = {
    id: row.id,
    sku: row.sku ?? null,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    shortDescription: row.short_description ?? "",
    price: effectivePrice,
    originalPrice: onSale ? Number(row.price) : undefined,
    discountPercent,
    comparePrice: row.compare_price != null ? Number(row.compare_price) : undefined,
    images,
    category: row.category?.name ?? "",
    categorySlug: row.category?.slug ?? "",
    tags: row.tags ?? [],
    colors,
    isCustomizable: Boolean(row.customization_rules?.is_customizable),
    customizationOptions: toCustomizationOptionsDTO(row.customization_rules),
    customizable: Boolean(row.customizable),
    customizations,
    fromPrice: hasVariablePricing ? effectivePrice + fromPriceAdjustment : undefined,
    stock: row.stock,
    featured: row.featured,
    bestseller: row.bestseller,
    newArrival: row.new_arrival,
    rating: Number(row.rating ?? 0),
    reviewCount: row.review_count ?? 0,
    estimatedDelivery: row.estimated_delivery ?? "",
    dimensions: row.dimensions ?? undefined,
    materials: row.materials ?? [],
    careInstructions: row.care_instructions ?? [],
    status: row.status ?? "active",
    productType: row.product_type ?? "ready_to_ship",
    processingMinDays: row.processing_min_days ?? undefined,
    processingMaxDays: row.processing_max_days ?? undefined,
    processingMessage: row.processing_message ?? undefined,
    trackInventory: row.track_inventory ?? true,
    allowBackorders: row.allow_backorders ?? false,
    continueSellingWhenOutOfStock: row.continue_selling_when_out_of_stock ?? false,
    freeShipping: row.free_shipping ?? false,
    localPickupAvailable: row.local_pickup_available ?? false,
    metaTitle: row.meta_title ?? undefined,
    metaDescription: row.meta_description ?? undefined,
  };

  if (!opts.admin) return base;

  return {
    ...base,
    costPrice: row.cost_price != null ? Number(row.cost_price) : undefined,
    isTaxable: row.is_taxable ?? true,
    taxClass: row.tax_class ?? undefined,
    salePrice: row.sale_price != null ? Number(row.sale_price) : undefined,
    saleStartDate: row.sale_start_date ?? undefined,
    saleEndDate: row.sale_end_date ?? undefined,
    lowStockThreshold: row.low_stock_threshold ?? 5,
    isPhysical: row.is_physical ?? true,
    weight: row.weight != null ? Number(row.weight) : undefined,
    length: row.length != null ? Number(row.length) : undefined,
    width: row.width != null ? Number(row.width) : undefined,
    height: row.height != null ? Number(row.height) : undefined,
    shippingClass: row.shipping_class ?? undefined,
    searchKeywords: row.search_keywords ?? undefined,
    categoryId: row.category_id ?? null,
    additionalCategoryIds: (row.product_categories ?? [])
      .filter((pc: any) => !pc.is_primary)
      .map((pc: any) => pc.category_id),
    updatedAt: row.updated_at ?? undefined,
  };
}

export const PRODUCT_SELECT = `
  *,
  category:categories!products_category_id_fkey(name, slug),
  product_images(url, sort_order, is_primary),
  product_colors(sort_order, colors(hex, name)),
  product_categories(category_id, is_primary),
  customization_rules(
    *,
    customization_allowed_colors(colors(hex))
  ),
  product_customizations(
    *,
    customization_values!customization_values_customization_id_fkey(*)
  )
`;
