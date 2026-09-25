import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../../config/supabase.js";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { sensitiveLimiter } from "../../middleware/rateLimiter.js";
import { HttpError } from "../../lib/httpError.js";

// ---- Public: newsletter signup (footer + homepage section) ----
export const newsletterRouter = Router();

const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.string().max(40).optional(),
});

newsletterRouter.post("/", sensitiveLimiter, validate(subscribeSchema), async (req, res, next) => {
  try {
    const { email, source } = req.body as z.infer<typeof subscribeSchema>;
    const { data: existing } = await supabaseAdmin.from("newsletter_subscribers").select("id, status").eq("email", email).maybeSingle();
    if (existing) {
      // Re-subscribing is fine and idempotent; never reveal whether an address was already on the list
      if (existing.status !== "subscribed") {
        await supabaseAdmin.from("newsletter_subscribers").update({ status: "subscribed" }).eq("id", existing.id);
      }
    } else {
      const { error } = await supabaseAdmin.from("newsletter_subscribers").insert({ email, source: source ?? null });
      if (error && error.code !== "23505") throw HttpError.internal(error.message);
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Admin: subscriber list ----
export const adminNewsletterRouter = Router();
adminNewsletterRouter.use(authenticate, requireAdmin);

/* eslint-disable @typescript-eslint/no-explicit-any */
const toDTO = (r: any) => ({ id: r.id, email: r.email, source: r.source, status: r.status, createdAt: r.created_at });

adminNewsletterRouter.get("/", requirePermission("customers.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("newsletter_subscribers").select("*").order("created_at", { ascending: false });
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toDTO));
  } catch (err) {
    next(err);
  }
});

/** CSV of subscribed addresses, for importing into an email tool. */
adminNewsletterRouter.get("/export", requirePermission("customers.view"), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("newsletter_subscribers")
      .select("email, source, created_at")
      .eq("status", "subscribed")
      .order("created_at", { ascending: true });
    if (error) throw HttpError.internal(error.message);
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["email,source,subscribed_at", ...(data ?? []).map((r) => [r.email, r.source, r.created_at].map(escape).join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="newsletter-subscribers.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

adminNewsletterRouter.patch(
  "/:id",
  requirePermission("customers.update"),
  validate(z.object({ status: z.enum(["subscribed", "unsubscribed"]) })),
  async (req, res, next) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("newsletter_subscribers")
        .update({ status: (req.body as { status: string }).status })
        .eq("id", req.params.id)
        .select("*")
        .maybeSingle();
      if (error) throw HttpError.internal(error.message);
      if (!data) throw HttpError.notFound("Subscriber not found");
      res.json(toDTO(data));
    } catch (err) {
      next(err);
    }
  }
);

adminNewsletterRouter.delete("/:id", requirePermission("customers.delete"), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("newsletter_subscribers").delete().eq("id", req.params.id);
    if (error) throw HttpError.internal(error.message);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
