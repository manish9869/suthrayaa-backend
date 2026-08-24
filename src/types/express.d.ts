import type { AuthUser } from "../middleware/auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      admin?: { id: string; role: string; display_name: string | null };
    }
  }
}

export {};
