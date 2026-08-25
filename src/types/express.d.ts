import type { AuthUser } from "../middleware/auth.js";
import type { UserRbac } from "../modules/rbac/rbac.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      admin?: { id: string; role: string; display_name: string | null; is_active: boolean };
      rbac?: UserRbac;
    }
  }
}

export {};
