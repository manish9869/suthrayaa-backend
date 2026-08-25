// Single source of truth for every permission slug the backend enforces and the frontend
// reads. `resource.action` naming throughout. Keep this in sync with the frontend's
// lib/rbac/permissions.ts constants — the frontend list is generated from this catalog's
// slugs and must not drift.

export interface PermissionDef {
  slug: string;
  name: string;
  resource: string;
  action: string;
  description: string;
  group: string;
}

const ACTION_LABEL: Record<string, string> = {
  view: "View",
  create: "Create",
  update: "Update",
  delete: "Delete",
  publish: "Publish",
  cancel: "Cancel",
  refund: "Refund",
  export: "Export",
  adjust: "Adjust",
  manage: "Manage",
  assign_role: "Assign roles",
  assign_permissions: "Assign permissions",
  branding: "Branding",
  storefront: "Storefront",
  tax: "GST & Tax",
  shipping: "Shipping",
  payment: "Payments",
  email: "Email",
  maintenance: "Maintenance",
  analytics: "Analytics",
};

function group(groupName: string, resource: string, resourceLabel: string, actions: string[]): PermissionDef[] {
  return actions.map((action) => ({
    slug: `${resource}.${action}`,
    name: `${resourceLabel} ${ACTION_LABEL[action] ?? action}`,
    resource,
    action,
    description: `${ACTION_LABEL[action] ?? action} ${resourceLabel.toLowerCase()}`,
    group: groupName,
  }));
}

export const PERMISSIONS: PermissionDef[] = [
  // Catalog
  ...group("Catalog", "products", "Products", ["view", "create", "update", "delete", "publish"]),
  ...group("Catalog", "product_images", "Product Images", ["manage"]),
  ...group("Catalog", "categories", "Categories", ["view", "create", "update", "delete"]),
  ...group("Catalog", "colors", "Colors", ["view", "create", "update", "delete"]),
  ...group("Catalog", "inventory", "Inventory", ["view", "update", "adjust"]),

  // Sales
  ...group("Sales", "orders", "Orders", ["view", "update", "cancel", "refund", "export"]),
  ...group("Sales", "coupons", "Coupons", ["view", "create", "update", "delete"]),
  ...group("Sales", "customers", "Customers", ["view", "update", "delete"]),

  // Content
  ...group("Content", "content", "Content", ["view", "create", "update", "delete"]),
  ...group("Content", "banners", "Banners", ["view", "create", "update", "delete"]),

  // Reviews
  ...group("Reviews", "reviews", "Reviews", ["view", "update", "delete"]),

  // Communications
  ...group("Communications", "emails", "Emails", ["view", "update"]),

  // Administration
  ...group("Administration", "users", "Users", ["view", "create", "update", "delete", "assign_role"]),
  ...group("Administration", "roles", "Roles", ["view", "create", "update", "delete", "assign_permissions"]),
  // "view"/"update" are the baseline every settings.* group needs; the rest gate one
  // specific, business-critical group each (checked IN ADDITION to settings.update — see
  // SENSITIVE_GROUP_PERMISSION in settings.catalog.ts) so no admin gets unrestricted access
  // to GST/payment/maintenance just by having generic "can edit settings" access.
  ...group("Administration", "settings", "Settings", [
    "view",
    "update",
    "branding",
    "storefront",
    "tax",
    "shipping",
    "payment",
    "email",
    "maintenance",
    "analytics",
  ]),
  ...group("Administration", "audit_logs", "Audit Logs", ["view"]),

  // Analytics
  ...group("Analytics", "analytics", "Analytics", ["view", "export"]),
];

export const PERMISSION_SLUGS = new Set(PERMISSIONS.map((p) => p.slug));

export function isValidPermissionSlug(slug: string): boolean {
  return PERMISSION_SLUGS.has(slug);
}
