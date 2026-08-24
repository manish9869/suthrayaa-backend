import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { substituteTemplate, resendLoggedEmail } from "../email/email.service.js";

export const adminEmailTemplatesRouter = Router();
export const adminEmailLogsRouter = Router();
for (const r of [adminEmailTemplatesRouter, adminEmailLogsRouter]) r.use(authenticate, requireAdmin);

const SAMPLE_VARIABLES: Record<string, string> = {
  customer_name: "Priya Sharma",
  order_number: "ORD-2026-0042",
  order_date: new Date().toLocaleDateString("en-IN"),
  order_total: "₹1,499",
  tracking_number: "TRACK123456",
  product_name: "Crochet Sunflower Pot",
  invoice_number: "INV-2026-0042",
  store_name: "Suthrayaa",
};
const SAMPLE_RAW: Record<string, string> = {
  items_table: "<p style=\"color:#999;font-style:italic;\">[Order items table renders here]</p>",
  address_block: "<p style=\"color:#999;font-style:italic;\">[Shipping address renders here]</p>",
};

function toTemplateDTO(row: any) {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    bodyHtml: row.body_html,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  };
}

adminEmailTemplatesRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("email_templates").select("*").order("type");
    if (error) throw HttpError.internal(error.message);
    res.json((data ?? []).map(toTemplateDTO));
  } catch (err) {
    next(err);
  }
});

const templateUpdateSchema = z.object({
  subject: z.string().min(1).optional(),
  bodyHtml: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

adminEmailTemplatesRouter.patch("/:id", validate(templateUpdateSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof templateUpdateSchema>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.subject !== undefined) update.subject = b.subject;
    if (b.bodyHtml !== undefined) update.body_html = b.bodyHtml;
    if (b.enabled !== undefined) update.enabled = b.enabled;

    const { data, error } = await supabaseAdmin.from("email_templates").update(update).eq("id", req.params.id).select("*").maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!data) throw HttpError.notFound("Template not found");
    res.json(toTemplateDTO(data));
  } catch (err) {
    next(err);
  }
});

adminEmailTemplatesRouter.post("/:id/preview", async (req, res, next) => {
  try {
    const { data: template } = await supabaseAdmin.from("email_templates").select("*").eq("id", req.params.id).maybeSingle();
    if (!template) throw HttpError.notFound("Template not found");
    res.json({
      subject: substituteTemplate(template.subject, SAMPLE_VARIABLES, SAMPLE_RAW),
      bodyHtml: substituteTemplate(template.body_html, SAMPLE_VARIABLES, SAMPLE_RAW),
    });
  } catch (err) {
    next(err);
  }
});

const testSendSchema = z.object({ to: z.string().email() });
adminEmailTemplatesRouter.post("/:id/test-send", validate(testSendSchema), async (req, res, next) => {
  try {
    const { to } = req.body as z.infer<typeof testSendSchema>;
    const { data: template } = await supabaseAdmin.from("email_templates").select("*").eq("id", req.params.id).maybeSingle();
    if (!template) throw HttpError.notFound("Template not found");

    const subject = `[TEST] ${substituteTemplate(template.subject, SAMPLE_VARIABLES, SAMPLE_RAW)}`;
    const bodyHtml = substituteTemplate(template.body_html, SAMPLE_VARIABLES, SAMPLE_RAW);
    await resendLoggedEmail(to, subject, bodyHtml);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Logs ----

adminEmailLogsRouter.get("/", async (req, res, next) => {
  try {
    const { status, type, page = "1", limit = "50" } = req.query as Record<string, string>;
    let query = supabaseAdmin.from("email_logs").select("*", { count: "exact" }).order("sent_at", { ascending: false });
    if (status) query = query.eq("status", status);
    if (type) query = query.eq("type", type);

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 50));
    query = query.range((pageNum - 1) * limitNum, pageNum * limitNum - 1);

    const { data, error, count } = await query;
    if (error) throw HttpError.internal(error.message);
    res.json({
      items: (data ?? []).map((l: any) => ({
        id: l.id,
        type: l.type,
        recipient: l.recipient,
        orderId: l.order_id,
        subject: l.subject,
        status: l.status,
        errorMessage: l.error_message,
        sentAt: l.sent_at,
      })),
      total: count ?? 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    next(err);
  }
});

adminEmailLogsRouter.post("/:id/retry", async (req, res, next) => {
  try {
    const { data: log, error } = await supabaseAdmin.from("email_logs").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw HttpError.internal(error.message);
    if (!log) throw HttpError.notFound("Log not found");
    if (!log.body_html) throw HttpError.badRequest("This email predates retry support and has no stored content");

    let status = "sent";
    let errorMessage: string | null = null;
    try {
      await resendLoggedEmail(log.recipient, log.subject ?? "(no subject)", log.body_html);
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    await supabaseAdmin.from("email_logs").insert({
      type: log.type,
      recipient: log.recipient,
      order_id: log.order_id,
      subject: log.subject,
      body_html: log.body_html,
      status,
      error_message: errorMessage,
    });
    res.json({ ok: status === "sent" });
  } catch (err) {
    next(err);
  }
});
