import request from "supertest";
import { createApp } from "../app.js";
import { db } from "./db.js";

export const app = createApp();
export const api = () => request(app);

export const CUSTOMER_A = "11111111-1111-4111-8111-111111111111";
export const CUSTOMER_B = "22222222-2222-4222-8222-222222222222";
export const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
export const STAFF_ID = "44444444-4444-4444-8444-444444444444";

export const PRODUCT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
export const SIZED_PRODUCT_ID = "aaaaaaaa-0000-4000-8000-000000000002";
export const HIDDEN_PRODUCT_ID = "aaaaaaaa-0000-4000-8000-000000000003";
export const SIZE_GROUP_ID = "bbbbbbbb-0000-4000-8000-000000000001";
export const SIZE_SMALL_ID = "cccccccc-0000-4000-8000-000000000001";
export const SIZE_LARGE_ID = "cccccccc-0000-4000-8000-000000000002";

/** Bearer header understood by the jose stub in setup.ts. */
export const auth = (userId: string, email = `${userId.slice(0, 4)}@example.com`) => ({ Authorization: `Bearer test~${userId}~${email}` });

export const ADDRESS = {
  firstName: "Priya",
  lastName: "Sharma",
  phone: "9876543210",
  email: "priya@example.com",
  addressLine1: "12 Lotus Apartments, MG Road",
  city: "Pune",
  state: "Maharashtra",
  pincode: "411001",
};

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: "Amigurumi Bunny",
  slug: `product-${id.slice(-1)}`,
  sku: `SKU-${id.slice(-1)}`,
  price: 500,
  sale_price: null,
  stock: 5,
  track_inventory: true,
  allow_backorders: false,
  continue_selling_when_out_of_stock: false,
  is_active: true,
  status: "active",
  tax_category_id: null,
  created_at: new Date().toISOString(),
  ...over,
});

/** Fresh catalog + RBAC state for every test. */
export function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  db.reset({
    products: [
      product(PRODUCT_ID),
      product(SIZED_PRODUCT_ID, { name: "Crochet Tote", price: 800, stock: 10 }),
      product(HIDDEN_PRODUCT_ID, { name: "Archived Scarf", is_active: false, status: "archived" }),
    ],
    product_customizations: [
      { id: SIZE_GROUP_ID, product_id: SIZED_PRODUCT_ID, name: "size", label: "Size", type: "choice", required: true, enabled: true, sort_order: 0 },
    ],
    customization_values: [
      { id: SIZE_SMALL_ID, customization_id: SIZE_GROUP_ID, label: "Small", value: "S", price_adjustment: 0, enabled: true, sort_order: 0 },
      { id: SIZE_LARGE_ID, customization_id: SIZE_GROUP_ID, label: "Large", value: "L", price_adjustment: 100, enabled: true, sort_order: 1 },
    ],
    coupons: [
      { id: "dddddddd-0000-4000-8000-000000000001", code: "WELCOME10", type: "percent", value: 10, min_subtotal: 0, is_active: true, uses_count: 0, max_uses: null, max_uses_per_customer: 1 },
    ],
    // RBAC: a super admin, and a staff member who can only view orders
    admin_users: [
      { id: ADMIN_ID, role: "admin", display_name: "Owner", is_active: true },
      { id: STAFF_ID, role: "staff", display_name: "Staff", is_active: true },
    ],
    roles: [
      { id: "eeeeeeee-0000-4000-8000-000000000001", name: "Super Admin", slug: "super-admin", is_system_role: true },
      { id: "eeeeeeee-0000-4000-8000-000000000002", name: "Order Viewer", slug: "order_viewer", is_system_role: false },
      { id: "eeeeeeee-0000-4000-8000-000000000003", name: "Manager", slug: "manager", is_system_role: false },
    ],
    permissions: [
      { id: "ffffffff-0000-4000-8000-000000000001", slug: "orders.view" },
      { id: "ffffffff-0000-4000-8000-000000000002", slug: "roles.assign_permissions" },
      { id: "ffffffff-0000-4000-8000-000000000003", slug: "users.delete" },
      { id: "ffffffff-0000-4000-8000-000000000004", slug: "users.assign_role" },
    ],
    role_permissions: [
      { role_id: "eeeeeeee-0000-4000-8000-000000000002", permission_id: "ffffffff-0000-4000-8000-000000000001" },
      { role_id: "eeeeeeee-0000-4000-8000-000000000002", permission_id: "ffffffff-0000-4000-8000-000000000002" },
      { role_id: "eeeeeeee-0000-4000-8000-000000000002", permission_id: "ffffffff-0000-4000-8000-000000000004" },
      { role_id: "eeeeeeee-0000-4000-8000-000000000003", permission_id: "ffffffff-0000-4000-8000-000000000003" },
    ],
    user_roles: [
      { user_id: ADMIN_ID, role_id: "eeeeeeee-0000-4000-8000-000000000001" },
      { user_id: STAFF_ID, role_id: "eeeeeeee-0000-4000-8000-000000000002" },
    ],
    ...extra,
  });
}

/** Places a COD order for `userId` through the real API and returns the response body. */
export async function placeCodOrder(userId: string, items = [{ productId: PRODUCT_ID, quantity: 1 }], extra: Record<string, unknown> = {}) {
  return api()
    .post("/api/checkout/place-order")
    .set(auth(userId))
    .send({ items, shippingAddress: ADDRESS, shippingMethod: "standard", paymentMethod: "cod", ...extra });
}
