import type { Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { markOrderPaidByRazorpayOrderId, markOrderFailedByRazorpayOrderId } from "../checkout/checkout.service.js";

/**
 * Razorpay webhook — the authoritative backstop for payment confirmation, in case the
 * client never calls /checkout/verify-payment (closed tab, network drop, etc).
 * Idempotent: markOrderPaidByRazorpayOrderId no-ops if the order is already paid.
 */
export async function razorpayWebhookHandler(req: Request, res: Response) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    logger.warn("Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not configured — rejecting");
    return res.status(501).json({ error: "Webhook not configured" });
  }

  const signature = req.headers["x-razorpay-signature"];
  const rawBody = req.body as unknown;
  // The HMAC must be computed over the exact bytes Razorpay sent. If a platform body parser
  // (e.g. Vercel's Node helpers — disable with NODEJS_HELPERS=0) consumed the stream first,
  // we get a parsed object instead and can't verify; fail loudly rather than crash.
  if (!Buffer.isBuffer(rawBody)) {
    logger.error("Razorpay webhook: raw body unavailable (body was pre-parsed) — set NODEJS_HELPERS=0 on the host");
    return res.status(500).json({ error: "Raw body unavailable" });
  }

  const expected = crypto.createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(typeof signature === "string" ? signature : "");
  const expBuf = Buffer.from(expected);
  const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

  if (!valid) {
    logger.warn("Razorpay webhook signature mismatch");
    return res.status(400).json({ error: "Invalid signature" });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const event = payload.event as string;

  try {
    if (event === "payment.captured" || event === "order.paid") {
      const razorpayOrderId =
        payload.payload?.payment?.entity?.order_id ?? payload.payload?.order?.entity?.id;
      const razorpayPaymentId = payload.payload?.payment?.entity?.id;
      const ourOrderId = payload.payload?.payment?.entity?.notes?.orderId ?? payload.payload?.order?.entity?.notes?.orderId;
      if (razorpayOrderId) await markOrderPaidByRazorpayOrderId(razorpayOrderId, razorpayPaymentId, typeof ourOrderId === "string" ? ourOrderId : undefined);
    } else if (event === "payment.failed") {
      const razorpayOrderId = payload.payload?.payment?.entity?.order_id;
      if (razorpayOrderId) await markOrderFailedByRazorpayOrderId(razorpayOrderId);
    }
  } catch (err) {
    logger.error({ err }, "Failed to process Razorpay webhook");
  }

  res.status(200).json({ received: true });
}
