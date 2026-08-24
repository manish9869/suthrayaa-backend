import PDFDocument from "pdfkit";
import { supabaseAdmin } from "../../config/supabase.js";
import { formatPrice } from "../../lib/format.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface InvoiceSnapshotItem {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  customizations: { label: string; valueLabel?: string; textValue?: string; priceAdjustment: number }[];
}

interface InvoiceSnapshot {
  business: {
    name: string;
    logoUrl: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    taxNumber: string | null;
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
  total: number;
}

/** Idempotent — an order only ever gets one invoice, generated once at order placement.
 * The snapshot freezes pricing/product/business details as they were at that moment;
 * later product/settings edits never change an already-issued invoice. */
export async function createInvoiceForOrder(orderId: string) {
  const { data: existing } = await supabaseAdmin.from("invoices").select("*").eq("order_id", orderId).maybeSingle();
  if (existing) return existing;

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) throw orderErr ?? new Error("Order not found");

  const { data: settings } = await supabaseAdmin.from("invoice_settings").select("*").eq("id", 1).single();

  const { data: invoiceNumber, error: numberErr } = await supabaseAdmin.rpc("next_invoice_number");
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
      footer: settings?.footer ?? null,
      terms: settings?.terms ?? null,
      currency: settings?.currency ?? "INR",
      showSku: settings?.show_sku ?? true,
      showTax: settings?.show_tax ?? true,
      showCustomizationPricing: settings?.show_customization_pricing ?? true,
    },
    orderNumber: order.order_number,
    orderDate: order.placed_at ?? order.created_at,
    customerName: `${addr.firstName ?? ""} ${addr.lastName ?? ""}`.trim() || "Customer",
    customerEmail: order.guest_email ?? null,
    customerPhone: order.guest_phone ?? addr.phone ?? null,
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
    taxAmount: 0,
    total: Number(order.total),
  };

  const { data: invoice, error } = await supabaseAdmin
    .from("invoices")
    .insert({ invoice_number: invoiceNumber, order_id: orderId, snapshot })
    .select("*")
    .single();
  if (error) throw error;
  return invoice;
}

export async function getInvoiceForOrder(orderId: string) {
  const { data } = await supabaseAdmin.from("invoices").select("*").eq("order_id", orderId).maybeSingle();
  return data;
}

/** Fetches the store logo as a buffer for embedding in the PDF. pdfkit only supports
 * JPEG/PNG — any other format (or a failed fetch) just falls back to text-only, since a
 * missing logo should never break invoice generation. */
async function fetchLogoBuffer(logoUrl: string | null): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("png") && !contentType.includes("jpeg") && !contentType.includes("jpg")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Renders a stored invoice snapshot to a PDF buffer. `liveStatus`/`livePaymentStatus` are
 * read fresh from the order at render time — only pricing/product details stay frozen. */
export async function renderInvoicePdf(
  invoiceNumber: string,
  snapshot: InvoiceSnapshot,
  liveStatus: string,
  livePaymentStatus: string
): Promise<Buffer> {
  const logoBuffer = await fetchLogoBuffer(snapshot.business.logoUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fmt = (n: number) => formatPrice(n);

    // Header — logo (if any) at top-left, business name/details shifted right to make room.
    const textX = logoBuffer ? 110 : 50;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 50, 45, { fit: [50, 50] });
      } catch {
        // Corrupt/unsupported image data — fall back to text-only rather than fail the invoice.
      }
    }
    doc.fontSize(18).font("Helvetica-Bold").text(snapshot.business.name, textX, 50);
    doc.fontSize(9).font("Helvetica").fillColor("#555");
    const businessLines = [snapshot.business.address, snapshot.business.email, snapshot.business.phone, snapshot.business.taxNumber ? `Tax No: ${snapshot.business.taxNumber}` : null].filter(Boolean);
    doc.text(businessLines.join("\n"), textX, 72, { width: 280 - (textX - 50) });

    doc.fontSize(16).font("Helvetica-Bold").fillColor("#000").text("INVOICE", 350, 50, { width: 195, align: "right" });
    doc.fontSize(9).font("Helvetica").fillColor("#333");
    doc.text(
      [
        `Invoice #: ${invoiceNumber}`,
        `Order #: ${snapshot.orderNumber}`,
        `Date: ${new Date(snapshot.orderDate).toLocaleDateString("en-IN")}`,
        `Status: ${liveStatus.replace(/_/g, " ")}`,
        `Payment: ${livePaymentStatus.replace(/_/g, " ")}`,
      ].join("\n"),
      350,
      95,
      { width: 195, align: "right" }
    );

    let y = 165;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#ddd").stroke();
    y += 14;

    // Bill To / Ship To
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#000").text("Ship To", 50, y);
    y += 14;
    doc.fontSize(9).font("Helvetica").fillColor("#333");
    const a = snapshot.shippingAddress ?? {};
    doc.text(
      [
        snapshot.customerName,
        [a.addressLine1, a.addressLine2].filter(Boolean).join(", "),
        [a.city, a.state, a.pincode].filter(Boolean).join(", "),
        snapshot.customerPhone,
      ]
        .filter(Boolean)
        .join("\n"),
      50,
      y,
      { width: 300 }
    );

    y += 70;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#ddd").stroke();
    y += 10;

    // Items table header
    const showSku = snapshot.business.showSku;
    const colProduct = 50;
    const colSku = 260;
    const colQty = showSku ? 340 : 300;
    const colPrice = showSku ? 390 : 360;
    const colTotal = showSku ? 470 : 460;

    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Product", colProduct, y);
    if (showSku) doc.text("SKU", colSku, y);
    doc.text("Qty", colQty, y);
    doc.text("Price", colPrice, y);
    doc.text("Total", colTotal, y, { width: 75, align: "right" });
    y += 14;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#ddd").stroke();
    y += 8;

    doc.font("Helvetica");
    for (const item of snapshot.items) {
      doc.fontSize(9).fillColor("#000").text(item.name, colProduct, y, { width: showSku ? 200 : 240 });
      if (showSku) doc.text(item.sku ?? "—", colSku, y, { width: 70 });
      doc.text(String(item.quantity), colQty, y);
      doc.text(fmt(item.unitPrice), colPrice, y);
      doc.text(fmt(item.lineTotal), colTotal, y, { width: 75, align: "right" });
      y += 13;

      if (snapshot.business.showCustomizationPricing) {
        for (const c of item.customizations) {
          const val = c.valueLabel ?? c.textValue ?? "";
          const adj = c.priceAdjustment ? ` (${c.priceAdjustment > 0 ? "+" : ""}${fmt(c.priceAdjustment)})` : "";
          doc.fontSize(8).fillColor("#666").text(`${c.label}: ${val}${adj}`, colProduct + 10, y, { width: 300 });
          y += 11;
        }
      }
      y += 6;
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
    }

    y += 4;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#ddd").stroke();
    y += 10;

    // Totals
    const totalsRows: [string, number][] = [["Subtotal", snapshot.subtotal]];
    if (snapshot.discountAmount > 0) totalsRows.push(["Discount", -snapshot.discountAmount]);
    totalsRows.push(["Shipping", snapshot.shippingCost]);
    if (snapshot.giftWrapCost > 0) totalsRows.push(["Gift Wrap", snapshot.giftWrapCost]);
    if (snapshot.business.showTax && snapshot.taxAmount > 0) totalsRows.push(["Tax", snapshot.taxAmount]);

    doc.fontSize(9).font("Helvetica").fillColor("#333");
    for (const [label, amount] of totalsRows) {
      doc.text(label, 380, y, { width: 100 });
      doc.text(`${amount < 0 ? "-" : ""}${fmt(Math.abs(amount))}`, colTotal, y, { width: 75, align: "right" });
      y += 14;
    }
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
    doc.text("Total", 380, y, { width: 100 });
    doc.text(fmt(snapshot.total), colTotal, y, { width: 75, align: "right" });
    y += 20;

    doc.font("Helvetica").fontSize(8).fillColor("#666").text(`Payment method: ${snapshot.paymentMethod === "cod" ? "Cash on Delivery" : "Razorpay"}`, 50, y);
    y += 30;

    if (snapshot.business.footer) {
      doc.fontSize(8).fillColor("#888").text(snapshot.business.footer, 50, y, { width: 495, align: "center" });
      y += 14;
    }
    if (snapshot.business.terms) {
      doc.fontSize(7).fillColor("#aaa").text(snapshot.business.terms, 50, y, { width: 495, align: "center" });
    }

    doc.end();
  });
}
