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
import { buildInvoiceGst, invoiceDesignFromSettings, type InvoiceSnapshot } from "../invoices/invoice.service.js";
import { renderInvoicePdf } from "../invoices/invoice.pdf.js";

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
    tagline: row.tagline ?? "Handcrafted crochet, made to order",
    headerStyle: row.header_style ?? "dark",
    accent: row.accent ?? "peach",
    showHsn: row.show_hsn ?? true,
    showGstSummary: row.show_gst_summary ?? true,
    showAmountInWords: row.show_amount_in_words ?? true,
    showPayment: row.show_payment ?? true,
    showSignature: row.show_signature ?? true,
    signatoryName: row.signatory_name ?? "",
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
  tagline: z.string().max(80).optional(),
  headerStyle: z.enum(["dark", "light"]).optional(),
  accent: z.enum(["peach", "violet", "rose", "teal"]).optional(),
  showHsn: z.boolean().optional(),
  showGstSummary: z.boolean().optional(),
  showAmountInWords: z.boolean().optional(),
  showPayment: z.boolean().optional(),
  showSignature: z.boolean().optional(),
  signatoryName: z.string().max(80).optional(),
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
    if (b.tagline !== undefined) update.tagline = b.tagline;
    if (b.headerStyle !== undefined) update.header_style = b.headerStyle;
    if (b.accent !== undefined) update.accent = b.accent;
    if (b.showHsn !== undefined) update.show_hsn = b.showHsn;
    if (b.showGstSummary !== undefined) update.show_gst_summary = b.showGstSummary;
    if (b.showAmountInWords !== undefined) update.show_amount_in_words = b.showAmountInWords;
    if (b.showPayment !== undefined) update.show_payment = b.showPayment;
    if (b.showSignature !== undefined) update.show_signature = b.showSignature;
    if (b.signatoryName !== undefined) update.signatory_name = b.signatoryName || null;
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

/* ---------- live preview ---------- */

// Draft (unsaved) fields → invoice_settings columns, for the preview only.
const PREVIEW_COLUMNS: Record<string, string> = {
  businessName: "business_name",
  address: "address",
  email: "email",
  phone: "phone",
  taxNumber: "tax_number",
  footer: "footer",
  terms: "terms",
  showSku: "show_sku",
  showTax: "show_tax",
  showCustomizationPricing: "show_customization_pricing",
  tagline: "tagline",
  headerStyle: "header_style",
  accent: "accent",
  showHsn: "show_hsn",
  showGstSummary: "show_gst_summary",
  showAmountInWords: "show_amount_in_words",
  showPayment: "show_payment",
  showSignature: "show_signature",
  signatoryName: "signatory_name",
};

/**
 * Renders a sample invoice with the saved settings overlaid by the page's unsaved draft, so
 * the Invoice Settings page can show exactly what the next invoice will look like. GST
 * identity always comes from the saved settings (it isn't editable on that page).
 */
adminInvoiceSettingsRouter.post("/preview", requirePermission("settings.view"), validate(settingsSchema), async (req, res, next) => {
  try {
    const { data: saved, error } = await supabaseAdmin.from("invoice_settings").select("*").eq("id", 1).single();
    if (error) throw HttpError.internal(error.message);
    const row: any = { ...saved };
    for (const [key, col] of Object.entries(PREVIEW_COLUMNS)) {
      const v = (req.body as any)[key];
      if (v !== undefined) row[col] = v;
    }

    const items = [
      { product_id: null, name: "Classic Crochet Sunflower Bouquet", sku: "CR-FLOW-SUN-001", quantity: 2, unit: 499, customizations: [{ label: "Colour", valueLabel: "Sunshine Yellow", priceAdjustment: 0 }] },
      { product_id: null, name: "Convertible Star Bottle Holder", sku: "CR-BAG-BTL-001", quantity: 1, unit: 549, customizations: [{ label: "Name tag", textValue: "Aditya", priceAdjustment: 50 }] },
      { product_id: null, name: "Amigurumi Bunny Keychain", sku: "CR-KEY-BUN-002", quantity: 3, unit: 199, customizations: [] },
    ];
    const subtotal = items.reduce((a, i) => a + i.unit * i.quantity, 0);
    const discount = 200;
    const shipping = 79;
    const giftWrap = 49;
    const total = subtotal - discount + shipping + giftWrap;
    const sellerState = String(row.gst_state ?? "").trim();
    const address = {
      firstName: "Aditya",
      lastName: "Chauhan",
      addressLine1: "64 Test Layout, 2nd Cross",
      addressLine2: "Near City Park",
      city: "Pune",
      state: sellerState && isValidIndianState(sellerState) ? sellerState : "Maharashtra",
      pincode: "411001",
      phone: "9984112400",
    };
    const orderLike = {
      order_items: items.map((i) => ({ product_id: i.product_id, line_total: i.unit * i.quantity })),
      discount_amount: discount,
      shipping_cost: shipping,
      gift_wrap_cost: giftWrap,
      total,
      shipping_address: address,
    };

    const snapshot: InvoiceSnapshot = {
      business: {
        name: row.business_name || "Suthrayaa",
        logoUrl: row.logo_url ?? null,
        address: row.address ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        taxNumber: row.tax_number ?? null,
        gstin: row.is_gst_registered ? row.gstin ?? null : null,
        footer: row.footer ?? null,
        terms: row.terms ?? null,
        currency: row.currency ?? "INR",
        showSku: row.show_sku ?? true,
        showTax: row.show_tax ?? true,
        showCustomizationPricing: row.show_customization_pricing ?? true,
        ...invoiceDesignFromSettings(row),
      },
      orderNumber: "SUT-PREVIEW",
      orderDate: new Date().toISOString(),
      customerName: "Aditya Chauhan",
      customerEmail: "aditya@example.com",
      customerPhone: "9984112400",
      shippingAddress: address,
      paymentMethod: "razorpay",
      items: items.map((i) => ({ name: i.name, sku: i.sku, quantity: i.quantity, unitPrice: i.unit, lineTotal: i.unit * i.quantity, customizations: i.customizations })),
      subtotal,
      discountAmount: discount,
      shippingCost: shipping,
      giftWrapCost: giftWrap,
      taxAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      taxLabel: "GST",
      total,
    };
    const gst = await buildInvoiceGst(orderLike, row).catch(() => null);
    if (gst) {
      snapshot.gst = gst;
      snapshot.taxAmount = gst.totalTax;
      snapshot.cgstAmount = gst.cgst;
      snapshot.sgstAmount = gst.sgst;
      snapshot.igstAmount = gst.igst;
    }

    const pdf = await renderInvoicePdf(`${row.invoice_prefix || "INV"}-PREVIEW`, snapshot, "confirmed", "paid");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="invoice-preview.pdf"');
    res.setHeader("Cache-Control", "no-store");
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});
