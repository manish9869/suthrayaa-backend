import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";

export const adminMeRouter = Router();

// Used by the Next.js admin layout to gate access after Supabase auth confirms a session,
// and to drive every permission-aware UI decision (sidebar, route guards, buttons) on the
// frontend. No specific permission required beyond being an active admin — everyone needs
// to be able to load their own profile.
adminMeRouter.get("/me", authenticate, requireAdmin, (req, res) => {
  res.json({
    id: req.admin!.id,
    email: req.user!.email ?? null,
    displayName: req.admin!.display_name,
    isActive: req.admin!.is_active,
    role: req.admin!.role,
    roles: req.rbac!.roles,
    permissions: Array.from(req.rbac!.permissions),
    isSuperAdmin: req.rbac!.isSuperAdmin,
  });
});
