import { rateLimit } from "express-rate-limit";

const PAYMENT_CALLBACK_PATHS = ["/api/webhooks/razorpay", "/api/checkout/verify-payment"];

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
  // Signature-verified payment callbacks are never throttled: a paying customer (or Razorpay
  // retrying a webhook) must not be turned away because others share their IP (mobile CGNAT).
  skip: (req) =>
    req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" || PAYMENT_CALLBACK_PATHS.includes(req.path),
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

/**
 * Order placement / payment creation. Its own counter (not shared with login, coupons, etc.)
 * and roomier than sensitiveLimiter, since many shoppers can sit behind one carrier IP.
 */
export const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many requests, please try again later.", code: "RATE_LIMITED" } },
});

/** Payment verification is HMAC-checked before any DB work, so only a loose abuse cap. */
export const paymentVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many requests, please try again later.", code: "RATE_LIMITED" } },
});
