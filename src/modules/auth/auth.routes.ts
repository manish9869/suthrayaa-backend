import { Router, type Request } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { sensitiveLimiter, moderateLimiter } from "../../middleware/rateLimiter.js";
import { HttpError } from "../../lib/httpError.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { logAudit } from "../rbac/audit.service.js";

/**
 * Auth gateway — the storefront and admin console never talk to Supabase directly (no Supabase
 * URL or key in the frontend). Every sign-in / sign-up / password / session operation goes
 * through these endpoints, which call Supabase Auth (GoTrue) server-side with the publishable
 * key. Sessions are the normal Supabase JWTs, so `authenticate` keeps verifying them unchanged.
 *
 * Email links (confirm sign-up, reset password, change email) and Google sign-in land on the
 * frontend's /auth/callback, which reads the tokens from the URL fragment and stores the session.
 */
export const authRouter = Router();

const GOTRUE = `${env.SUPABASE_URL}/auth/v1`;

interface GoTrueUser {
  id: string;
  email?: string;
  phone?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: { provider?: string; providers?: string[] };
}
interface GoTrueSession {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: GoTrueUser;
}

async function gotrue<T>(path: string, init: { method?: string; body?: unknown; token?: string; query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(GOTRUE + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message: string = data.error_description ?? data.msg ?? data.message ?? data.error ?? "Authentication failed";
    if (/invalid login credentials/i.test(message)) throw HttpError.unauthorized("Incorrect email or password");
    if (/email not confirmed/i.test(message)) throw HttpError.badRequest("Please confirm your email first — check your inbox for the link");
    if (/already registered|already been registered/i.test(message)) throw HttpError.conflict("An account with this email already exists — try signing in");
    if (res.status === 429) throw new HttpError(429, "Too many attempts — please wait a minute and try again");
    if (res.status >= 500) throw HttpError.internal(message);
    throw new HttpError(res.status === 401 ? 401 : 400, message);
  }
  return data as T;
}

/** What the frontend stores — never includes provider secrets. */
function toUser(u: GoTrueUser) {
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? null,
    phone: u.phone || null,
    firstName: (meta.first_name as string) ?? null,
    lastName: (meta.last_name as string) ?? null,
    providers: u.app_metadata?.providers ?? (u.app_metadata?.provider ? [u.app_metadata.provider] : []),
  };
}
function toSession(s: GoTrueSession) {
  if (!s.access_token || !s.refresh_token || !s.user) return null;
  return {
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
    user: toUser(s.user),
  };
}

/** Only ever redirect back to our own frontend (prevents open redirects via email links). */
function frontendCallback(next?: string) {
  const path = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
  return `${env.FRONTEND_URL}/auth/callback?next=${encodeURIComponent(path)}`;
}

const bearer = (req: Request) => req.headers.authorization!.slice("Bearer ".length);

// ---- sessions ----

const credentials = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

/** The admin_users id for a user id / email, or null for customers. Best-effort — auditing must never break sign-in. */
async function adminIdFor(by: { id?: string; email?: string }): Promise<string | null> {
  try {
    let id = by.id;
    if (!id && by.email) {
      const { data } = await supabaseAdmin.from("customer_profiles").select("id").ilike("email", by.email).maybeSingle();
      id = data?.id;
    }
    if (!id) return null;
    const { data: admin } = await supabaseAdmin.from("admin_users").select("id").eq("id", id).maybeSingle();
    return admin?.id ?? null;
  } catch {
    return null;
  }
}

authRouter.post("/login", sensitiveLimiter, validate(credentials), async (req, res, next) => {
  const { email, password } = req.body as z.infer<typeof credentials>;
  try {
    const session = toSession(await gotrue<GoTrueSession>("/token", { query: { grant_type: "password" }, body: { email, password } }));
    if (!session) throw HttpError.unauthorized("Incorrect email or password");
    // Admin sign-ins (and failed attempts on admin accounts) go to the audit log; customers' don't
    const adminId = await adminIdFor({ id: session.user.id });
    if (adminId) await logAudit({ userId: adminId, action: "ADMIN_LOGIN", resource: "auth", resourceId: adminId, metadata: { email }, req });
    res.json({ session });
  } catch (err) {
    if (err instanceof HttpError && err.status < 500) {
      const adminId = await adminIdFor({ email });
      if (adminId) await logAudit({ userId: adminId, action: "ADMIN_LOGIN_FAILED", resource: "auth", resourceId: adminId, metadata: { email }, req });
    }
    next(err);
  }
});

authRouter.post("/refresh", moderateLimiter, validate(z.object({ refreshToken: z.string().min(10) })), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const session = toSession(await gotrue<GoTrueSession>("/token", { query: { grant_type: "refresh_token" }, body: { refresh_token: refreshToken } }));
    if (!session) throw HttpError.unauthorized("Session expired");
    res.json({ session });
  } catch (err) {
    next(err instanceof HttpError && err.status < 500 ? HttpError.unauthorized("Session expired — please sign in again") : err);
  }
});

/** scope: "local" = this device, "others" = every other device, "global" = everywhere. */
authRouter.post("/logout", authenticate, validate(z.object({ scope: z.enum(["local", "others", "global"]).default("local") })), async (req, res, next) => {
  try {
    const { scope } = req.body as { scope: string };
    await gotrue("/logout", { token: bearer(req), query: { scope } });
    const adminId = await adminIdFor({ id: req.user!.id });
    if (adminId) await logAudit({ userId: adminId, action: "ADMIN_LOGOUT", resource: "auth", resourceId: adminId, metadata: { scope }, req });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** The signed-in user (used after an email-link / Google redirect to fill in the session). */
authRouter.get("/user", authenticate, async (req, res, next) => {
  try {
    res.json({ user: toUser(await gotrue<GoTrueUser>("/user", { method: "GET", token: bearer(req) })) });
  } catch (err) {
    next(err);
  }
});

// ---- sign-up & password ----

const signupSchema = credentials.extend({
  password: z.string().min(8).max(200),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  next: z.string().max(300).optional(),
});

authRouter.post("/signup", sensitiveLimiter, validate(signupSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof signupSchema>;
    const data = await gotrue<GoTrueSession & GoTrueUser>("/signup", {
      query: { redirect_to: frontendCallback(b.next) },
      body: { email: b.email, password: b.password, data: { first_name: b.firstName, last_name: b.lastName } },
    });
    // With email confirmation on, GoTrue returns the user but no session yet
    const session = toSession(data);
    res.status(201).json({ session, needsConfirmation: !session });
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  "/forgot-password",
  sensitiveLimiter,
  validate(z.object({ email: z.string().trim().toLowerCase().email() })),
  async (req, res, next) => {
    try {
      const { email } = req.body as { email: string };
      await gotrue("/recover", { query: { redirect_to: frontendCallback("/login?mode=reset") }, body: { email } });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

/** Change password. `currentPassword` is required unless this is a fresh password-recovery session. */
authRouter.post(
  "/password",
  sensitiveLimiter,
  authenticate,
  validate(z.object({ password: z.string().min(8).max(200), currentPassword: z.string().max(200).optional() })),
  async (req, res, next) => {
    try {
      const { password, currentPassword } = req.body as { password: string; currentPassword?: string };
      if (currentPassword !== undefined) {
        if (!req.user!.email) throw HttpError.badRequest("This account has no email password to verify");
        try {
          await gotrue("/token", { query: { grant_type: "password" }, body: { email: req.user!.email, password: currentPassword } });
        } catch {
          throw HttpError.badRequest("Your current password is incorrect");
        }
      }
      await gotrue("/user", { method: "PUT", token: bearer(req), body: { password } });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

/** Change email — Supabase emails a confirmation link that lands on /auth/callback. */
authRouter.post("/email", sensitiveLimiter, authenticate, validate(z.object({ email: z.string().trim().toLowerCase().email() })), async (req, res, next) => {
  try {
    const { email } = req.body as { email: string };
    await gotrue("/user", { method: "PUT", token: bearer(req), query: { redirect_to: frontendCallback("/account/profile") }, body: { email } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Google sign-in ----

/** Browser navigates here; we bounce it to the Google consent screen via Supabase. Supabase then
 * redirects to the frontend's /auth/callback with the session in the URL fragment. */
authRouter.get("/oauth/:provider", moderateLimiter, (req, res, next) => {
  try {
    const provider = req.params.provider;
    if (provider !== "google") throw HttpError.badRequest("Unsupported sign-in provider");
    const url = new URL(`${GOTRUE}/authorize`);
    url.searchParams.set("provider", provider);
    url.searchParams.set("redirect_to", frontendCallback(typeof req.query.next === "string" ? req.query.next : "/"));
    res.redirect(302, url.toString());
  } catch (err) {
    next(err);
  }
});
