import { rateLimit } from "express-rate-limit";

/**
 * Baseline limit for writes (POST/PUT/PATCH/DELETE). Reads are exempt: they're cheap, cached by
 * the storefront, and a single Vercel build prerenders every page from one IP — a read cap would
 * fail production builds. Sensitive and costly routes keep their own limiters below.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS",
  message: { error: { message: "Too many requests, please try again later.", code: "RATE_LIMITED" } },
});

/** Moderate limit for endpoints that are cheap to call but do real work per request. */
export const moderateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many requests, please try again later.", code: "RATE_LIMITED" } },
});

/** Tighter limit for checkout/auth-adjacent/write-heavy routes. */
export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many requests, please try again later.", code: "RATE_LIMITED" } },
});
