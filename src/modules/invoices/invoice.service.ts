import PDFDocument from "pdfkit";
import { supabaseAdmin } from "../../config/supabase.js";

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

// Mirrors the warm terracotta/cream palette in app/globals.css and email.service.ts's
// BRAND tokens. pdfkit takes plain hex only (no CSS vars, no rgba shorthand for fills),
// so translucent-looking backgrounds are pre-mixed flat tints instead.
const BRAND = {
  ink: "#3a2420",
  muted: "#8a7a63",
  border: "#e8dcc4",
  primary: "#c1502e",
  primaryTint: "#f8e6da",
  cardBg: "#fbf6ee",
  headerBg: "#3a2420",
  mint: "#dcebd7",
  mintInk: "#22391f",
  gold: "#f5e6c8",
  goldInk: "#5c3a1e",
  destructiveBg: "#f6dcdc",
  destructiveInk: "#7a1f1f",
};

function statusPillColors(paymentStatus: string): { bg: string; fg: string } {
  if (paymentStatus === "paid") return { bg: BRAND.mint, fg: BRAND.mintInk };
  if (paymentStatus === "failed") return { bg: BRAND.destructiveBg, fg: BRAND.destructiveInk };
  if (paymentStatus === "refunded" || paymentStatus === "partially_refunded") return { bg: BRAND.gold, fg: BRAND.goldInk };
  return { bg: BRAND.cardBg, fg: BRAND.muted };
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

    // pdfkit's built-in Helvetica is a base-14 PDF font (WinAnsi encoding only) — it has no
    // glyph for ₹, so formatPrice()'s output renders as a garbled superscript in the PDF
    // (fine in HTML/email, broken here). "Rs." is plain ASCII and renders correctly.
    const fmt = (n: number) => `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.abs(n))}`;
    const pageW = doc.page.width;
    const left = 50;
    const right = pageW - 50;
    const contentW = right - left;

    // Top accent bar
    doc.rect(0, 0, pageW, 6).fill(BRAND.primary);

    // Header — logo (if any) at top-left, business name/details shifted right to make room.
    const textX = logoBuffer ? 108 : left;
    if (logoBuffer) {
      try {
        doc.roundedRect(left, 38, 48, 48, 8).fill(BRAND.cardBg);
        doc.image(logoBuffer, left + 4, 42, { fit: [40, 40] });
      } catch {
        // Corrupt/unsupported image data — fall back to text-only rather than fail the invoice.
      }
    }
    doc.fontSize(18).font("Helvetica-Bold").fillColor(BRAND.ink).text(snapshot.business.name, textX, 42);
    doc.fontSize(8).font("Helvetica").fillColor(BRAND.muted);
    const businessLines = [snapshot.business.address, snapshot.business.email, snapshot.business.phone, snapshot.business.taxNumber ? `Tax No: ${snapshot.business.taxNumber}` : null].filter(Boolean);
    doc.text(businessLines.join("\n"), textX, 64, { width: (left + 280) - textX });

    // Right side — "INVOICE" title, number, and a payment-status pill
    doc.fontSize(8).font("Helvetica-Bold").fillColor(BRAND.muted).text("PAYMENT RECEIPT", left + 300, 38, { width: contentW - 300, align: "right", characterSpacing: 1 });
    doc.fontSize(24).font("Helvetica-Bold").fillColor(BRAND.ink).text("INVOICE", left + 300, 50, { width: contentW - 300, align: "right" });
    doc.fontSize(9).font("Helvetica").fillColor(BRAND.muted).text(`No. ${invoiceNumber}`, left + 300, 80, { width: contentW - 300, align: "right" });

    const pillLabel = livePaymentStatus.replace(/_/g, " ").toUpperCase();
    const pillColors = statusPillColors(livePaymentStatus);
    doc.fontSize(8).font("Helvetica-Bold");
    const pillW = doc.widthOfString(pillLabel) + 22;
    const pillH = 18;
    const pillX = right - pillW;
    const pillY = 96;
    doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2).fill(pillColors.bg);
    doc.fillColor(pillColors.fg).text(pillLabel, pillX, pillY + 5, { width: pillW, align: "center" });

    let y = 132;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(BRAND.border).lineWidth(1).stroke();
    y += 18;

    // FROM / BILL TO / INVOICE DATE — three info cards
    const cardGap = 10;
    const cardW = (contentW - cardGap * 2) / 3;
    const cardH = 92;
    const cardTop = y;
    const a = snapshot.shippingAddress ?? {};
    const cards: { x: number; label: string; title: string; lines: string[] }[] = [
      { x: left, label: "FROM", title: snapshot.business.name, lines: [snapshot.business.address, snapshot.business.email].filter((v): v is string => Boolean(v)) },
      { x: left + cardW + cardGap, label: "BILL TO", title: snapshot.customerName, lines: [snapshot.customerEmail, snapshot.customerPhone].filter((v): v is string => Boolean(v)) },
      {
        x: left + 2 * (cardW + cardGap),
        label: "INVOICE DATE",
        title: new Date(snapshot.orderDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        lines: [`Order status: ${liveStatus.replace(/_/g, " ")}`],
      },
    ];
    for (const c of cards) {
      doc.roundedRect(c.x, cardTop, cardW, cardH, 8).fill(BRAND.cardBg);
      doc.fontSize(7).font("Helvetica-Bold").fillColor(BRAND.primary).text(c.label, c.x + 14, cardTop + 14, { characterSpacing: 1 });
      doc.fontSize(10).font("Helvetica-Bold").fillColor(BRAND.ink).text(c.title, c.x + 14, cardTop + 28, { width: cardW - 28 });
      doc.fontSize(8).font("Helvetica").fillColor(BRAND.muted).text(c.lines.join("\n"), c.x + 14, cardTop + 44, { width: cardW - 28 });
    }
    y = cardTop + cardH + 26;

    // Ship To
    doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND.primary).text("SHIP TO", left, y, { characterSpacing: 1 });
    y += 14;
    doc.fontSize(9).font("Helvetica").fillColor(BRAND.ink);
    doc.text(
      [snapshot.customerName, [a.addressLine1, a.addressLine2].filter(Boolean).join(", "), [a.city, a.state, a.pincode].filter(Boolean).join(", ")].filter(Boolean).join("\n"),
      left,
      y,
      { width: 320 }
    );
    y += 52;

    // Items table — dark header band
    const showSku = snapshot.business.showSku;
    const colProduct = left + 12;
    const colSku = left + 220;
    const colQty = showSku ? left + 300 : left + 260;
    const colPrice = showSku ? left + 340 : left + 310;
    const colTotal = left + contentW - 85;

    doc.roundedRect(left, y, contentW, 24, 6).fill(BRAND.headerBg);
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#fff8f0");
    doc.text("PRODUCT", colProduct, y + 8);
    if (showSku) doc.text("SKU", colSku, y + 8);
    doc.text("QTY", colQty, y + 8);
    doc.text("PRICE", colPrice, y + 8);
    doc.text("TOTAL", colTotal, y + 8, { width: 85 - 10, align: "right" });
    y += 24 + 12;

    doc.font("Helvetica");
    for (const item of snapshot.items) {
      doc.fontSize(9).fillColor(BRAND.ink).text(item.name, colProduct, y, { width: showSku ? colSku - colProduct - 10 : colQty - colProduct - 10 });
      if (showSku) doc.text(item.sku ?? "—", colSku, y, { width: 70 });
      doc.text(String(item.quantity), colQty, y);
      doc.text(fmt(item.unitPrice), colPrice, y);
      doc.text(fmt(item.lineTotal), colTotal, y, { width: 85 - 10, align: "right" });
      y += 14;

      if (snapshot.business.showCustomizationPricing) {
        for (const c of item.customizations) {
          const val = c.valueLabel ?? c.textValue ?? "";
          const adj = c.priceAdjustment ? ` (${c.priceAdjustment > 0 ? "+" : ""}${fmt(c.priceAdjustment)})` : "";
          doc.fontSize(8).fillColor(BRAND.muted).text(`${c.label}: ${val}${adj}`, colProduct + 10, y, { width: 300 });
          y += 12;
        }
      }
      y += 8;
      doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor(BRAND.border).lineWidth(0.75).stroke();

      if (y > 700) {
        doc.addPage();
        doc.rect(0, 0, pageW, 6).fill(BRAND.primary);
        y = 50;
      }
    }

    y += 10;

    // Totals
    const totalsRows: [string, number][] = [["Subtotal", snapshot.subtotal]];
    if (snapshot.discountAmount > 0) totalsRows.push(["Discount", -snapshot.discountAmount]);
    totalsRows.push(["Shipping", snapshot.shippingCost]);
    if (snapshot.giftWrapCost > 0) totalsRows.push(["Gift Wrap", snapshot.giftWrapCost]);
    if (snapshot.business.showTax && snapshot.taxAmount > 0) totalsRows.push(["Tax", snapshot.taxAmount]);

    doc.fontSize(9).font("Helvetica");
    for (const [label, amount] of totalsRows) {
      doc.fillColor(BRAND.muted).text(label, left + contentW - 220, y, { width: 130 });
      doc.fillColor(BRAND.ink).text(`${amount < 0 ? "-" : ""}${fmt(amount)}`, colTotal, y, { width: 85 - 10, align: "right" });
      y += 16;
    }

    y += 6;
    const bandH = 42;
    doc.roundedRect(left + contentW - 220, y, 220, bandH, 8).fill(BRAND.primaryTint);
    doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND.muted).text("TOTAL", left + contentW - 220 + 16, y + 15, { characterSpacing: 1 });
    doc.fontSize(18).font("Helvetica-Bold").fillColor(BRAND.primary).text(fmt(snapshot.total), left + contentW - 220, y + 11, { width: 210, align: "right" });
    y += bandH + 22;

    doc.font("Helvetica").fontSize(8).fillColor(BRAND.muted).text(`Payment method: ${snapshot.paymentMethod === "cod" ? "Cash on Delivery" : "Razorpay"}`, left, y);
    y += 26;

    doc.moveTo(left, y).lineTo(right, y).strokeColor(BRAND.border).lineWidth(1).stroke();
    y += 14;

    if (snapshot.business.footer) {
      doc.fontSize(9).font("Helvetica-Bold").fillColor(BRAND.ink).text(snapshot.business.footer, left, y, { width: contentW, align: "center" });
      y += 16;
    }
    if (snapshot.business.terms) {
      doc.fontSize(7).font("Helvetica").fillColor(BRAND.muted).text(snapshot.business.terms, left, y, { width: contentW, align: "center" });
      y += 14;
    }

    doc.end();
  });
}
