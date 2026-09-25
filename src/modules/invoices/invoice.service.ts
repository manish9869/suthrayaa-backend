import { supabaseAdmin } from "../../config/supabase.js";
import { getSetting } from "../settings/settings.service.js";
import { computeOrderGst, type OrderGstComputed, type OrderGstSummaryRow } from "../settings/tax.service.js";
import { stateCodeFor } from "../settings/india.data.js";
import { getTaxCategories } from "../settings/taxCategories.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface InvoiceSnapshotItem {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  customizations: {
    label: string;
    valueLabel?: string;
    textValue?: string;
    priceAdjustment: number;
  }[];
}

export interface InvoiceSnapshot {
  business: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    taxNumber: string | null;
    gstin: string | null;
    footer: string | null;
    terms: string | null;
    currency: string;
    showSku: boolean;
    showTax: boolean;
    showCustomizationPricing: boolean;
    // Design options — optional so snapshots taken before they existed render as before
    tagline?: string | null;
    headerStyle?: "dark" | "light";
    accent?: "peach" | "violet" | "rose" | "teal";
    showHsn?: boolean;
    showGstSummary?: boolean;
    showAmountInWords?: boolean;
    showPayment?: boolean;
    showSignature?: boolean;
    signatoryName?: string | null;
  };

  orderNumber: string;
  orderDate: string;

  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;

  shippingAddress: any;

  paymentMethod: string;

  items: InvoiceSnapshotItem[];

  subtotal: number;
  discountAmount: number;
  shippingCost: number;
  giftWrapCost: number;

  taxAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  taxLabel: string;

  total: number;

  /** Present on GST tax invoices (registered business with GST enabled). Older snapshots
   * don't have it and render from the order-level CGST/SGST/IGST figures above. */
  gst?: InvoiceGst;
}

export interface InvoiceGst {
  legalName: string | null;
  gstin: string;
  pan: string | null;
  supplierState: string | null;
  supplierStateCode: string | null;
  placeOfSupply: string | null;
  placeOfSupplyCode: string | null;
  isInterState: boolean;
  pricesIncludeGst: boolean;
  /** One entry per `items[i]`. */
  lines: OrderGstComputed[];
  /** Shipping / gift wrap, taxed at the principal supply's rate. */
  charges: OrderGstComputed[];
  summary: OrderGstSummaryRow[];
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  /** order total − (taxable value + tax); normally 0. */
  roundOff: number;
}

/** Invoice design options from an invoice_settings row (defaults = the standard layout). */
export function invoiceDesignFromSettings(settings: any) {
  return {
    tagline: settings?.tagline ?? "Handcrafted crochet, made to order",
    headerStyle: settings?.header_style === "light" ? ("light" as const) : ("dark" as const),
    accent: (["peach", "violet", "rose", "teal"].includes(settings?.accent) ? settings.accent : "peach") as "peach" | "violet" | "rose" | "teal",
    showHsn: settings?.show_hsn ?? true,
    showGstSummary: settings?.show_gst_summary ?? true,
    showAmountInWords: settings?.show_amount_in_words ?? true,
    showPayment: settings?.show_payment ?? true,
    showSignature: settings?.show_signature ?? true,
    signatoryName: settings?.signatory_name ?? null,
  };
}

/** Builds the GST section of an invoice, or null when the business isn't set up for GST. */
export async function buildInvoiceGst(order: any, settings: any): Promise<InvoiceGst | null> {
  const gstin = settings?.is_gst_registered ? String(settings?.gstin ?? "").trim() : "";
  if (!gstin) return null;
  const [gstEnabled, pricesIncludeGst, businessGstState, defaultTaxCategoryId] = await Promise.all([
    getSetting<boolean>("tax.gst_enabled").catch(() => false),
    getSetting<boolean>("tax.prices_include_gst").catch(() => true),
    getSetting<string>("business.gst_state").catch(() => ""),
    getSetting<string>("tax.default_tax_category_id").catch(() => ""),
  ]);
  const supplierState = String(settings?.gst_state || businessGstState || "").trim() || null;
  const buyerState = String(order.shipping_address?.state ?? "").trim() || null;
  if (!gstEnabled || !supplierState || !buyerState) return null;

  const items: any[] = order.order_items ?? [];
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  const { data: products } = productIds.length
    ? await supabaseAdmin.from("products").select("id, tax_category_id").in("id", productIds)
    : { data: [] as any[] };
  const categoryOf = new Map((products ?? []).map((p: any) => [p.id, p.tax_category_id as string | null]));
  const categories = await getTaxCategories();
  const fallback = categories.get(defaultTaxCategoryId);

  const gst = computeOrderGst({
    lines: items.map((i) => {
      const cat = categories.get(categoryOf.get(i.product_id) ?? "") ?? fallback;
      return { amount: Number(i.line_total), ratePercent: cat?.rate ?? 0, hsn: cat?.hsn ?? null };
    }),
    discount: Number(order.discount_amount ?? 0),
    charges: [
      { label: "Shipping", amount: Number(order.shipping_cost ?? 0) },
      { label: "Gift wrap", amount: Number(order.gift_wrap_cost ?? 0) },
    ],
    sellerState: supplierState,
    buyerState,
    pricesIncludeGst,
  });

  return {
    legalName: String(settings?.gst_legal_name ?? "").trim() || null,
    gstin,
    pan: String(settings?.pan ?? "").trim() || (gstin.length === 15 ? gstin.slice(2, 12) : null),
    supplierState,
    supplierStateCode: String(settings?.gst_state_code ?? "").trim() || stateCodeFor(supplierState) || null,
    placeOfSupply: buyerState,
    placeOfSupplyCode: stateCodeFor(buyerState) ?? null,
    isInterState: gst.isInterState,
    pricesIncludeGst,
    lines: gst.lines,
    charges: gst.charges,
    summary: gst.summary,
    taxableValue: gst.taxableValue,
    cgst: gst.cgst,
    sgst: gst.sgst,
    igst: gst.igst,
    totalTax: gst.totalTax,
    roundOff: Math.round((Number(order.total) - gst.grandTotal) * 100) / 100,
  };
}

/* ============================================================
   INVOICE CREATION
   ============================================================ */

export async function createInvoiceForOrder(orderId: string) {
  const { data: existing } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (existing) return existing;

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) {
    throw orderErr ?? new Error("Order not found");
  }

  const { data: settings } = await supabaseAdmin
    .from("invoice_settings")
    .select("*")
    .eq("id", 1)
    .single();

  const { data: invoiceNumber, error: numberErr } =
    await supabaseAdmin.rpc("next_invoice_number");

  if (numberErr) throw numberErr;

  const addr = order.shipping_address ?? {};

  const snapshot: InvoiceSnapshot = {
    business: {
      name: settings?.business_name ?? "Suthrayaa",
      logoUrl: settings?.logo_url ?? null,
      address: settings?.address ?? null,
      email: settings?.email ?? null,
      phone: settings?.phone ?? null,
      taxNumber: settings?.tax_number ?? null,
      gstin: settings?.is_gst_registered
        ? settings?.gstin ?? null
        : null,
      footer: settings?.footer ?? null,
      terms: settings?.terms ?? null,
      currency: settings?.currency ?? "INR",
      showSku: settings?.show_sku ?? true,
      showTax: settings?.show_tax ?? true,
      showCustomizationPricing:
        settings?.show_customization_pricing ?? true,
      ...invoiceDesignFromSettings(settings),
    },

    orderNumber: order.order_number,
    orderDate: order.placed_at ?? order.created_at,

    customerName:
      `${addr.firstName ?? ""} ${addr.lastName ?? ""}`.trim() ||
      "Customer",

    customerEmail: order.guest_email ?? null,

    customerPhone:
      order.guest_phone ??
      addr.phone ??
      null,

    shippingAddress: addr,

    paymentMethod: order.payment_method,

    items: (order.order_items ?? []).map((i: any) => ({
      name: i.product_name_snapshot,
      sku: i.product_sku_snapshot ?? null,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price_snapshot),
      lineTotal: Number(i.line_total),
      customizations: i.customizations ?? [],
    })),

    subtotal: Number(order.subtotal),
    discountAmount: Number(order.discount_amount),
    shippingCost: Number(order.shipping_cost),
    giftWrapCost: Number(order.gift_wrap_cost),

    taxAmount: Number(order.tax_amount ?? 0),
    cgstAmount: Number(order.cgst_amount ?? 0),
    sgstAmount: Number(order.sgst_amount ?? 0),
    igstAmount: Number(order.igst_amount ?? 0),

    taxLabel: await getSetting<string>("tax.tax_label").catch(
      () => "GST"
    ),

    total: Number(order.total),
  };

  const gst = await buildInvoiceGst(order, settings);
  if (gst) snapshot.gst = gst;

  const { data: invoice, error } = await supabaseAdmin
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      order_id: orderId,
      snapshot,
    })
    .select("*")
    .single();

  if (error?.code === "23505") {
    // Created concurrently by another request — use that one
    const { data: existingNow } = await supabaseAdmin.from("invoices").select("*").eq("order_id", orderId).maybeSingle();
    if (existingNow) return existingNow;
  }
  if (error) throw error;

  return invoice;
}

export async function getInvoiceForOrder(orderId: string) {
  const { data } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  return data;
}

/* ============================================================
   PDF — rendered by ./invoice.pdf.ts (brand-matched layout)
   ============================================================ */

export { renderInvoicePdf } from "./invoice.pdf.js";
