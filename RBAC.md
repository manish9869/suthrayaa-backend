# RBAC

Suthrayaa's admin panel uses role-based access control: **users → roles → permissions**.
The backend is the sole authority — every admin API route requires a specific permission
slug via `requirePermission("resource.action")`; the frontend hiding a nav item or button is
UX only.

## How it fits together

```
Request → authenticate (Supabase JWT) → requireAdmin (admin_users row + is_active)
        → req.rbac loaded fresh from DB (roles + permissions, no cache, no JWT embedding)
        → requirePermission("x.y") → route handler
```

`GET /api/admin/me` returns the signed-in admin's roles, effective permissions, and
`isSuperAdmin` — the frontend's `RbacProvider` (`lib/rbac/rbac-context.tsx`) loads this once
per session and drives `usePermission()`/`<Can>`/`<ProtectedRoute>`.

## Schema

`roles`, `permissions`, `role_permissions`, `user_roles`, `admin_invites`, `audit_logs` — see
`supabase/migrations/0011_rbac.sql`. `admin_users.role` (the old single-role column) is left
in place but unused for authorization; `admin_users.is_active` gates access.

## Permission catalog

Single source of truth: `src/modules/rbac/permissions.catalog.ts` (57 `resource.action`
slugs, grouped by module). Default roles and their grants: `src/modules/rbac/roles.catalog.ts`.
Add a new permission by adding one line to the catalog, adding it to whichever default
role(s) should have it, then re-running the seed:

```
pnpm seed:rbac
```

This is idempotent — safe to run any time the catalog changes. It only touches system roles
(`is_system_role = true`); custom roles created via the UI are never modified by it.

## Default (system) roles

Super Admin, Catalog Manager, Order Manager, Content Manager, Marketing Manager, Support
Agent, Viewer — see `roles.catalog.ts` for exact grants. System roles can't be renamed,
deleted, or have their permissions edited (enforced in `admin.roles.routes.ts`); create a
custom role instead if you need something different.

## Safeguards

- The last **active** Super Admin can't be deleted, deactivated, or have the Super Admin role
  removed (`countActiveSuperAdmins()` in `rbac.service.ts`, checked inline in
  `admin.users.routes.ts` before every such mutation).
- Only an existing Super Admin can grant or remove the Super Admin role from anyone
  (including via an invite) — this is what stops a normal admin from self-escalating.
- System roles are read-only; only custom roles can be edited/deleted, and only while unassigned.

## Adding a new admin

There's no "create user, set their password" flow — an admin with `users.create` +
`users.assign_role` sends an invite (`POST /api/admin/users/invite`), which is a single-use,
7-day, hashed token. The invitee sets their own password at `/admin/register/[token]` — a
route that isn't linked anywhere in the app UI, only reachable via the generated link.

## One-time migration (already run against production)

```
pnpm seed:rbac              # permissions + system roles
pnpm migrate:admin-roles    # backfills user_roles from the legacy admin_users.role column
```

`migrate-admin-roles.ts` maps every legacy role to `super-admin` (all three legacy values —
`super_admin`/`admin`/`staff` — granted identical full access in the old code, so this is the
only mapping that guarantees zero regression). Re-assign any non-`super_admin` legacy users to
a narrower role via the Roles UI afterward.

## Tests

`pnpm test` runs `vitest` against the permission-evaluation logic itself (`can()`,
`requirePermission`, catalog consistency) — no live DB required.
