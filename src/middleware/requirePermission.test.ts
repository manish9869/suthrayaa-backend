import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { requirePermission, requireAnyPermission } from "./requirePermission.js";
import type { UserRbac } from "../modules/rbac/rbac.service.js";

function mockReq(rbac?: UserRbac): Request {
  return { rbac } as unknown as Request;
}
const mockRes = {} as Response;

describe("requirePermission", () => {
  it("calls next(403) when req.rbac is missing (requireAdmin didn't run / auth not populated)", () => {
    const next = vi.fn();
    requirePermission("products.view")(mockReq(undefined), mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 403 });
  });

  it("calls next(403) when the permission is absent", () => {
    const next = vi.fn();
    const rbac: UserRbac = { isSuperAdmin: false, permissions: new Set(["products.view"]), roles: [] };
    requirePermission("products.delete")(mockReq(rbac), mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 403 });
  });

  it("calls next() with no error when the permission is present", () => {
    const next = vi.fn();
    const rbac: UserRbac = { isSuperAdmin: false, permissions: new Set(["products.delete"]), roles: [] };
    requirePermission("products.delete")(mockReq(rbac), mockRes, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("Super Admin passes regardless of the permission set", () => {
    const next = vi.fn();
    const rbac: UserRbac = { isSuperAdmin: true, permissions: new Set(), roles: [] };
    requirePermission("users.delete")(mockReq(rbac), mockRes, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("requireAnyPermission", () => {
  it("passes if any listed permission is present", () => {
    const next = vi.fn();
    const rbac: UserRbac = { isSuperAdmin: false, permissions: new Set(["inventory.view"]), roles: [] };
    requireAnyPermission("analytics.view", "inventory.view")(mockReq(rbac), mockRes, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("denies if none are present", () => {
    const next = vi.fn();
    const rbac: UserRbac = { isSuperAdmin: false, permissions: new Set(["orders.view"]), roles: [] };
    requireAnyPermission("analytics.view", "inventory.view")(mockReq(rbac), mockRes, next);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 403 });
  });
});
