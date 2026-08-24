import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),

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
