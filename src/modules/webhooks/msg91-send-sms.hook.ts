import type { Request, Response } from "express";
import { logger } from "../../lib/logger.js";
import { isPhoneOtpConfigured } from "../../config/env.js";

/**
 * Supabase Auth "Send SMS" hook receiver — DUMMY / PLACEHOLDER.
 *
 * Phone OTP delivery has not been decided/purchased yet (no SMS provider account exists).
 * Until MSG91_AUTH_KEY / MSG91_SENDER_ID / MSG91_OTP_TEMPLATE_ID are set in .env AND this
 * endpoint is wired up in Supabase Dashboard -> Auth -> Hooks -> Send SMS, it just logs the
 * request and returns success without sending any SMS. This lets the Phone OTP screen be
 * built and demoed end-to-end (minus an actual text message) without breaking the auth flow.
 */
export async function msg91SendSmsHookHandler(req: Request, res: Response) {
  if (!isPhoneOtpConfigured) {
    logger.warn(
      { phone: req.body?.user?.phone },
      "[dummy] Phone OTP hook called — no SMS provider configured yet, no SMS was sent"
    );
    return res.status(200).json({ ok: true, dummy: true });
  }

  // TODO(msg91): once credentials exist, POST req.body.sms.otp to req.body.user.phone
  // via MSG91's send-otp API here, per the Supabase Send SMS Hook payload contract.
  res.status(200).json({ ok: true });
}
