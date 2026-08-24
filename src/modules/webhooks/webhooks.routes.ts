import express, { Router } from "express";
import { razorpayWebhookHandler } from "./razorpay.webhook.js";
import { msg91SendSmsHookHandler } from "./msg91-send-sms.hook.js";

export const webhooksRouter = Router();

// Razorpay needs the raw request body to verify the HMAC signature, so it gets its own
// express.raw() here instead of the global express.json() parser mounted in app.ts.
webhooksRouter.post("/razorpay", express.raw({ type: "application/json" }), razorpayWebhookHandler);

webhooksRouter.post("/msg91-send-sms-hook", express.json(), msg91SendSmsHookHandler);
