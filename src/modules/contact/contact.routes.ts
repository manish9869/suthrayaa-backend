import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { sensitiveLimiter } from "../../middleware/rateLimiter.js";
import { sendContactFormEmails } from "../email/email.service.js";
import { logger } from "../../lib/logger.js";

export const contactRouter = Router();

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  subject: z.string().trim().max(150).optional(),
  message: z.string().trim().min(1).max(4000),
});

contactRouter.post("/", sensitiveLimiter, validate(contactSchema), async (req, res, next) => {
  try {
    const payload = req.body as z.infer<typeof contactSchema>;
    // Never blocks the response on email delivery — a misconfigured mailbox shouldn't turn
    // into a 500 for the customer; sendContactFormEmails already logs failures internally.
    sendContactFormEmails(payload).catch((err) => logger.error({ err }, "sendContactFormEmails failed"));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
