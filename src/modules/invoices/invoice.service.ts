import { supabaseAdmin } from "../../config/supabase.js";
import { getSetting } from "../settings/settings.service.js";

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

  const { data: invoice, error } = await supabaseAdmin
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      order_id: orderId,
      snapshot,
    })
    .select("*")
    .single();

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
