import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";
import { HttpError } from "../lib/httpError.js";

const JWKS = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL));

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
}

async function verify(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${env.SUPABASE_URL}/auth/v1`,
  });
  return {
    id: payload.sub as string,
    email: payload.email as string | undefined,
    phone: payload.phone as string | undefined,
  };
}

/** Requires a valid Supabase-issued JWT. Populates req.user or rejects with 401. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw HttpError.unauthorized("Missing bearer token");
    }
    req.user = await verify(header.slice("Bearer ".length));
    next();
  } catch {
    next(HttpError.unauthorized("Invalid or expired session"));
  }
}

/** Populates req.user when a valid token is present; never rejects. For guest-or-logged-in routes. */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  try {
    req.user = await verify(header.slice("Bearer ".length));
  } catch {
    // Invalid/expired token on an optional route — proceed as guest rather than failing the request.
  }
  next();
}
