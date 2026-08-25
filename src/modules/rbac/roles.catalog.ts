import { PERMISSIONS } from "./permissions.catalog.js";

export interface RoleDef {
  name: string;
  slug: string;
  description: string;
  isSystemRole: true;
  /** Super Admin bypasses permission checks entirely (see rbac.service.isSuperAdmin); its
   * grant list is every permission slug purely so the Roles UI can show an accurate count. */
  permissions: string[];
}

const ALL_SLUGS = PERMISSIONS.map((p) => p.slug);

function slugs(...patterns: string[]): string[] {
  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith(".*")) return [pattern];
    const resource = pattern.slice(0, -2);
    return PERMISSIONS.filter((p) => p.resource === resource).map((p) => p.slug);
  });
}

export const SYSTEM_ROLES: RoleDef[] = [
  {
    name: "Super Admin",
    slug: "super-admin",
    description: "Full access to every module, including user, role, and permission management.",
    isSystemRole: true,
    permissions: ALL_SLUGS,
  },
  {
    name: "Catalog Manager",
    slug: "catalog-manager",
    description: "Manages products, categories, colors, and inventory.",
    isSystemRole: true,
    permissions: slugs("products.*", "product_images.*", "categories.*", "colors.*", "inventory.view", "inventory.update"),
  },
  {
    name: "Order Manager",
    slug: "order-manager",
    description: "Manages orders and fulfillment, with read access to customers and inventory.",
    isSystemRole: true,
    permissions: slugs("orders.*", "customers.view", "customers.update", "inventory.view", "settings.view", "settings.shipping"),
  },
  {
    name: "Content Manager",
    slug: "content-manager",
    description: "Manages storefront content and banners.",
    isSystemRole: true,
    permissions: slugs("content.*", "banners.*", "settings.view", "settings.storefront"),
  },
  {
    name: "Marketing Manager",
    slug: "marketing-manager",
    description: "Manages coupons and views analytics.",
    isSystemRole: true,
    permissions: slugs("coupons.*", "analytics.view", "settings.view", "settings.analytics"),
  },
  {
    name: "Support Agent",
    slug: "support-agent",
    description: "Limited customer and order support access. Cannot modify prices, refund orders, or manage users.",
    isSystemRole: true,
    permissions: slugs("orders.view", "customers.view", "customers.update", "reviews.view", "reviews.update"),
  },
  {
    name: "Viewer",
    slug: "viewer",
    description: "Read-only access across the catalog, orders, customers, and analytics.",
    isSystemRole: true,
    permissions: slugs("products.view", "categories.view", "orders.view", "customers.view", "analytics.view", "inventory.view"),
  },
];
