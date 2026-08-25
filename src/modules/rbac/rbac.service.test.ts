import { describe, it, expect } from "vitest";
import { can, hasAnyPermission, hasRole, type UserRbac } from "./rbac.service.js";
import { PERMISSIONS, PERMISSION_SLUGS } from "./permissions.catalog.js";
import { SYSTEM_ROLES } from "./roles.catalog.js";

function rbacFixture(overrides: Partial<UserRbac> = {}): UserRbac {
  return {
    isSuperAdmin: false,
    permissions: new Set(["products.view"]),
    roles: [{ id: "role-1", name: "Catalog Manager", slug: "catalog-manager" }],
    ...overrides,
  };
}

describe("can()", () => {
  it("allows a permission the user's roles grant", () => {
    expect(can(rbacFixture(), "products.view")).toBe(true);
  });

  it("denies a permission not granted", () => {
    expect(can(rbacFixture(), "products.delete")).toBe(false);
  });

  it("Super Admin bypasses every check, even for a permission that doesn't exist", () => {
    const rbac = rbacFixture({ isSuperAdmin: true, permissions: new Set() });
    expect(can(rbac, "products.delete")).toBe(true);
    expect(can(rbac, "not.a.real.permission")).toBe(true);
  });
});

describe("hasAnyPermission()", () => {
  it("passes if at least one listed permission is present", () => {
    expect(hasAnyPermission(rbacFixture(), ["orders.view", "products.view"])).toBe(true);
  });

  it("fails if none are present", () => {
    expect(hasAnyPermission(rbacFixture(), ["orders.view", "orders.update"])).toBe(false);
  });
});

describe("hasRole()", () => {
  it("matches by slug", () => {
    expect(hasRole(rbacFixture(), "catalog-manager")).toBe(true);
    expect(hasRole(rbacFixture(), "order-manager")).toBe(false);
  });
});

describe("permission catalog consistency", () => {
  it("has no duplicate slugs", () => {
    const slugs = PERMISSIONS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every permission follows resource.action naming", () => {
    for (const p of PERMISSIONS) {
      expect(p.slug).toBe(`${p.resource}.${p.action}`);
    }
  });
});

describe("system role catalog consistency", () => {
  it("every granted slug exists in the permission catalog", () => {
    for (const role of SYSTEM_ROLES) {
      for (const slug of role.permissions) {
        expect(PERMISSION_SLUGS.has(slug), `${role.slug} grants unknown permission "${slug}"`).toBe(true);
      }
    }
  });

  it("every non-super role has no duplicate grants", () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.slug !== "super-admin")) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it("Support Agent cannot delete products, refund orders, or manage users/roles/settings", () => {
    const supportAgent = SYSTEM_ROLES.find((r) => r.slug === "support-agent")!;
    for (const forbidden of ["products.delete", "orders.refund", "orders.cancel", "users.view", "roles.view", "settings.update"]) {
      expect(supportAgent.permissions.includes(forbidden)).toBe(false);
    }
  });

  it("Viewer has no create/update/delete permissions", () => {
    const viewer = SYSTEM_ROLES.find((r) => r.slug === "viewer")!;
    for (const slug of viewer.permissions) {
      const perm = PERMISSIONS.find((p) => p.slug === slug)!;
      expect(["view"]).toContain(perm.action);
    }
  });
});
