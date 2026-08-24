import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";

export const adminInvoiceSettingsRouter = Router();
adminInvoiceSettingsRouter.use(authenticate, requireAdmin);

function toDTO(row: any) {
  return {
    businessName: row.business_name,
    logoUrl: row.logo_url ?? "",
    address: row.address ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    taxNumber: row.tax_number ?? "",
    invoicePrefix: row.invoice_prefix,
    footer: row.footer ?? "",
    terms: row.terms ?? "",
    currency: row.currency,
    showSku: row.show_sku,
    showTax: row.show_tax,
    showCustomizationPricing: row.show_customization_pricing,
  };
}

adminInvoiceSettingsRouter.get("/", async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("invoice_settings").select("*").eq("id", 1).single();
    if (error) throw HttpError.internal(error.message);
    res.json(toDTO(data));
  } catch (err) {
    next(err);
  }
});

const settingsSchema = z.object({
  businessName: z.string().min(1).optional(),
  logoUrl: z.string().optional(),
  address: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  taxNumber: z.string().optional(),
  invoicePrefix: z.string().min(1).optional(),
  footer: z.string().optional(),
  terms: z.string().optional(),
  currency: z.string().min(1).optional(),
  showSku: z.boolean().optional(),
  showTax: z.boolean().optional(),
  showCustomizationPricing: z.boolean().optional(),
});

adminInvoiceSettingsRouter.patch("/", validate(settingsSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof settingsSchema>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.businessName !== undefined) update.business_name = b.businessName;
    if (b.logoUrl !== undefined) update.logo_url = b.logoUrl;
    if (b.address !== undefined) update.address = b.address;
    if (b.email !== undefined) update.email = b.email;
    if (b.phone !== undefined) update.phone = b.phone;
    if (b.taxNumber !== undefined) update.tax_number = b.taxNumber;
    if (b.invoicePrefix !== undefined) update.invoice_prefix = b.invoicePrefix;
    if (b.footer !== undefined) update.footer = b.footer;
    if (b.terms !== undefined) update.terms = b.terms;
    if (b.currency !== undefined) update.currency = b.currency;
    if (b.showSku !== undefined) update.show_sku = b.showSku;
    if (b.showTax !== undefined) update.show_tax = b.showTax;
    if (b.showCustomizationPricing !== undefined) update.show_customization_pricing = b.showCustomizationPricing;

    const { data, error } = await supabaseAdmin.from("invoice_settings").update(update).eq("id", 1).select("*").single();
    if (error) throw HttpError.internal(error.message);
    res.json(toDTO(data));
  } catch (err) {
    next(err);
  }
});
