import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";

export const adminMeRouter = Router();

// Used by the Next.js admin layout to gate access after Supabase auth confirms a session.
adminMeRouter.get("/me", authenticate, requireAdmin, (req, res) => {
  res.json({ id: req.admin!.id, role: req.admin!.role, displayName: req.admin!.display_name });
});
