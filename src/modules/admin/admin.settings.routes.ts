import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.js";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { HttpError } from "../../lib/httpError.js";
import { logAudit } from "../rbac/audit.service.js";
import { can } from "../rbac/rbac.service.js";
import { isValidGstin, isValidPan, isValidIndianState, stateCodeFor } from "../settings/india.data.js";

export const adminInvoiceSettingsRouter = Router();
adminInvoiceSettingsRouter.use(authenticate, requireAdmin);

/* eslint-disable @typescript-eslint/no-explicit-any */

// GSTIN/PAN/GST legal identity are only included for a caller with settings.tax — a plain
// settings.view admin (e.g. regenerating an invoice) still sees business name/logo/address.
function toDTO(row: any, includeGst: boolean) {
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
    ...(includeGst
      ? {
          isGstRegistered: row.is_gst_registered ?? false,
          gstin: row.gstin ?? "",
          gstLegalName: row.gst_legal_name ?? "",
          gstState: row.gst_state ?? "",
          gstStateCode: row.gst_state_code ?? "",
          pan: row.pan ?? "",
          customerGstinOptional: row.customer_gstin_optional ?? true,
        }
      : {}),
  };
}

adminInvoiceSettingsRouter.get("/", requirePermission("settings.view"), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("invoice_settings").select("*").eq("id", 1).single();
    if (error) throw HttpError.internal(error.message);
    res.json(toDTO(data, can(req.rbac!, "settings.tax")));
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
  isGstRegistered: z.boolean().optional(),
  gstin: z.string().optional(),
  gstLegalName: z.string().optional(),
  gstState: z.string().optional(),
  pan: z.string().optional(),
  customerGstinOptional: z.boolean().optional(),
});

const GST_FIELDS = ["isGstRegistered", "gstin", "gstLegalName", "gstState", "pan", "customerGstinOptional"] as const;

adminInvoiceSettingsRouter.patch("/", requirePermission("settings.update"), validate(settingsSchema), async (req, res, next) => {
  try {
    const b = req.body as z.infer<typeof settingsSchema>;

    const touchesGst = GST_FIELDS.some((f) => b[f] !== undefined);
    if (touchesGst && !can(req.rbac!, "settings.tax")) {
      throw HttpError.forbidden("You do not have permission to edit GST settings.");
    }

    // GSTIN is only required — and only validated — when the business is actually
    // configured as GST-registered, per the spec's explicit "do not require GSTIN if not
    // registered" rule.
    const willBeRegistered = b.isGstRegistered ?? undefined;
    if (willBeRegistered || (willBeRegistered === undefined && b.gstin !== undefined)) {
      if (b.gstin !== undefined && b.gstin !== "" && !isValidGstin(b.gstin)) {
        throw HttpError.badRequest("Enter a valid 15-character GSTIN");
      }
    }
    if (b.pan !== undefined && b.pan !== "" && !isValidPan(b.pan)) throw HttpError.badRequest("Enter a valid PAN");
    if (b.gstState !== undefined && b.gstState !== "" && !isValidIndianState(b.gstState)) {
      throw HttpError.badRequest("Select a valid Indian state or union territory");
    }

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
    if (b.isGstRegistered !== undefined) update.is_gst_registered = b.isGstRegistered;
    if (b.gstin !== undefined) update.gstin = b.gstin || null;
    if (b.gstLegalName !== undefined) update.gst_legal_name = b.gstLegalName;
    if (b.gstState !== undefined) {
      update.gst_state = b.gstState;
      update.gst_state_code = b.gstState ? stateCodeFor(b.gstState) ?? null : null;
    }
    if (b.pan !== undefined) update.pan = b.pan || null;
    if (b.customerGstinOptional !== undefined) update.customer_gstin_optional = b.customerGstinOptional;

    const { data, error } = await supabaseAdmin.from("invoice_settings").update(update).eq("id", 1).select("*").single();
    if (error) throw HttpError.internal(error.message);
    await logAudit({
      userId: req.admin!.id,
      action: "SETTINGS_UPDATED",
      resource: "settings",
      resourceId: "invoice",
      permission: "settings.update",
      // Field NAMES only, never GSTIN/PAN values — matches the audit convention for secrets.
      metadata: { fields: Object.keys(update).filter((k) => k !== "updated_at") },
      req,
    });
    res.json(toDTO(data, can(req.rbac!, "settings.tax")));
  } catch (err) {
    next(err);
  }
});
