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
  };
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

export function toProductDTO(row: any, opts: { includeDisabledCustomizations?: boolean } = {}) {
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

  // "From ₹X" pricing on listing cards: lowest total across every required group's
  // cheapest value (optional groups don't force a price increase by default).
  const fromPriceAdjustment = customizations
    .filter((c: any) => c.required)
    .reduce((sum: number, c: any) => {
      const cheapest = c.values.reduce(
        (min: number, v: any) => Math.min(min, v.priceAdjustment),
        0
      );
      return sum + Math.max(0, cheapest);
    }, 0);

  return {
    id: row.id,
    sku: row.sku ?? null,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    shortDescription: row.short_description ?? "",
    price: Number(row.price),
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
    fromPrice: customizations.length > 0 ? Number(row.price) + fromPriceAdjustment : undefined,
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
  };
}

export const PRODUCT_SELECT = `
  *,
  category:categories(name, slug),
  product_images(url, sort_order, is_primary),
  product_colors(sort_order, colors(hex, name)),
  customization_rules(
    *,
    customization_allowed_colors(colors(hex))
  ),
  product_customizations(
    *,
    customization_values!customization_values_customization_id_fkey(*)
  )
`;
