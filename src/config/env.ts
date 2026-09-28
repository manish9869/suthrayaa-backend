import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  // Number of reverse proxies in front of the API (Render/Railway/Nginx = 1). Needed so rate
  // limits see the real client IP; 0 = trust none (don't set higher than the real hop count,
  // or clients can spoof X-Forwarded-For).
  // "off" hides /api/docs + /api/openapi.json (e.g. if you don't want the admin API surface public)
  API_DOCS: z.enum(["on", "off"]).default("on"),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_JWKS_URL: z.string().url(),

  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(""),

  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),

  SUPABASE_AUTH_HOOK_SECRET: z.string().optional().default(""),

  // Phone OTP provider — placeholder until MSG91 (or another provider) account is set up.
  MSG91_AUTH_KEY: z.string().optional().default(""),
  MSG91_SENDER_ID: z.string().optional().default(""),
  MSG91_OTP_TEMPLATE_ID: z.string().optional().default(""),

  // Transactional email via Gmail SMTP — GMAIL_APP_PASSWORD is a 16-char App Password
  // (myaccount.google.com/apppasswords), not the account's login password.
  GMAIL_USER: z.string().optional().default(""),
  GMAIL_APP_PASSWORD: z.string().optional().default(""),
  ADMIN_NOTIFICATION_EMAIL: z.string().optional().default("suthrayaa@gmail.com"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment variables — check .env against .env.example");
}

export const env = parsed.data;

export const isPhoneOtpConfigured = Boolean(
  env.MSG91_AUTH_KEY && env.MSG91_SENDER_ID && env.MSG91_OTP_TEMPLATE_ID
);

export const isEmailConfigured = Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);
