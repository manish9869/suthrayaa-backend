import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InvoiceSnapshot } from "./invoice.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ============================================================
   BRAND — matches the storefront (violet / peach / lilac / ink)
   ============================================================ */

const C = {
  ink: "#1C1642",
  inkSoft: "#2A2258",
  violet: "#6D4AFF",
  violetSoft: "#EFEAFF",
  lilacBg: "#F7F5FC",
  lilacText: "#C9BEFF",
  peach: "#FF9E7A",
  peachSoft: "#FFE6DC",
  text: "#1F1A33",
  muted: "#6B6485",
  faint: "#A49CC0",
  border: "#EBE6F5",
  white: "#FFFFFF",
  green: "#15803D",
  greenBg: "#E3F5E9",
  red: "#B42318",
  redBg: "#FDE7E5",
  gold: "#A15C07",
  goldBg: "#FEF0D7",
};

/* ============================================================
   FONTS & ASSETS (repo-root /assets, resolved from src or dist)
   ============================================================ */

const ASSET_DIR = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../assets"), // src/modules/invoices or dist/modules/invoices
    path.resolve(process.cwd(), "assets"),
  ];
  return candidates.find((d) => existsSync(path.join(d, "fonts"))) ?? null;
})();

const FONT_FILES = {
  serif: "Fraunces-Medium.ttf",
  serifItalic: "Fraunces-Italic.ttf",
  sans: "Jakarta-Regular.ttf",
  sansSemi: "Jakarta-SemiBold.ttf",
  sansBold: "Jakarta-Bold.ttf",
} as const;

type FontKey = keyof typeof FONT_FILES;

/** Registers the brand fonts; falls back to the built-in Helvetica family when missing. */
function registerFonts(doc: PDFKit.PDFDocument): { f: Record<FontKey, string>; rupee: boolean } {
  const fallback: Record<FontKey, string> = {
    serif: "Times-Bold",
    serifItalic: "Times-Italic",
    sans: "Helvetica",
    sansSemi: "Helvetica-Bold",
    sansBold: "Helvetica-Bold",
  };
  if (!ASSET_DIR) return { f: fallback, rupee: false };
  try {
    for (const [key, file] of Object.entries(FONT_FILES)) {
      doc.registerFont(key, path.join(ASSET_DIR, "fonts", file));
    }
    return { f: { serif: "serif", serifItalic: "serifItalic", sans: "sans", sansSemi: "sansSemi", sansBold: "sansBold" }, rupee: true };
  } catch {
    return { f: fallback, rupee: false };
  }
}

async function fetchLogoBuffer(logoUrl: string | null): Promise<Buffer | null> {
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && (type.includes("png") || type.includes("jpeg") || type.includes("jpg"))) {
        return Buffer.from(await res.arrayBuffer());
      }
    } catch {
      /* fall through to the bundled mark */
    }
  }
  const bundled = ASSET_DIR ? path.join(ASSET_DIR, "logo-mark.png") : null;
  if (bundled && existsSync(bundled)) {
    const { readFile } = await import("node:fs/promises");
    return readFile(bundled);
  }
  return null;
}

/* ============================================================
   FORMATTING
   ============================================================ */

const clean = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

function titleCase(v: string) {
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function paymentMethodLabel(method: string | null | undefined) {
  const v = String(method ?? "").toLowerCase();
  const map: Record<string, string> = { cod: "Cash on Delivery", razorpay: "Razorpay", upi: "UPI", card: "Card", netbanking: "Net Banking" };
  return map[v] ?? (v ? titleCase(v) : "—");
}

function formatDate(date: string) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function money(amount: number, currency: string, rupee: boolean) {
  const n = Math.abs(Number(amount) || 0);
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  const digits = n.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 });
  if (currency === "INR") return rupee ? `₹${digits}` : `Rs. ${digits}`;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${digits}`;
  }
}

/** Indian-system amount in words, e.g. 2,284 → "Two Thousand Two Hundred Eighty-Four Rupees Only". */
function amountInWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? `-${ones[n % 10]}` : ""));
  const three = (n: number) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ""}` : two(n));
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  if (rupees === 0 && paise === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  let words = parts.length ? `${parts.join(" ")} Rupees` : "";
  if (paise) words += `${words ? " and " : ""}${two(paise)} Paise`;
  return `${words} Only`;
}

function statusStyle(paymentStatus: string) {
  const s = paymentStatus.toLowerCase();
  if (["paid", "captured", "completed"].includes(s)) return { bg: C.greenBg, fg: C.green };
  if (["failed", "payment_failed"].includes(s)) return { bg: C.redBg, fg: C.red };
  if (["refunded", "partially_refunded"].includes(s)) return { bg: C.goldBg, fg: C.gold };
  return { bg: C.violetSoft, fg: C.violet };
}

/* ============================================================
   RENDER
   ============================================================ */

/**
 * Renders a stored invoice snapshot to an A4 PDF buffer.
 *
 * Pricing/product/business information comes from the frozen snapshot; order and payment
 * status are supplied live. Long orders flow onto continuation pages with a repeated table
 * header; totals never split across pages.
 */
export async function renderInvoicePdf(
  invoiceNumber: string,
  snapshot: InvoiceSnapshot,
  liveStatus: string,
  livePaymentStatus: string,
): Promise<Buffer> {
  const logo = await fetchLogoBuffer(snapshot.business.logoUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `Invoice ${invoiceNumber}`, Author: snapshot.business.name || "Suthrayaa" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { f, rupee } = registerFonts(doc);
    const currency = snapshot.business.currency || "INR";
    const fmt = (n: number) => money(n, currency, rupee);

    const W = doc.page.width;
    const H = doc.page.height;
    const M = 44;
    const R = W - M;
    const CW = R - M;
    const FOOTER_H = 64;
    const BOTTOM = H - FOOTER_H - 8;

    const text = (s: string, x: number, y: number, o: { font?: FontKey; size?: number; color?: string; width?: number; align?: "left" | "right" | "center"; spacing?: number; lineGap?: number } = {}) => {
      doc.font(f[o.font ?? "sans"]).fontSize(o.size ?? 9).fillColor(o.color ?? C.text);
      doc.text(s, x, y, { width: o.width, align: o.align ?? "left", characterSpacing: o.spacing ?? 0, lineGap: o.lineGap ?? 1.5, lineBreak: o.width !== undefined });
    };
    const height = (s: string, width: number, font: FontKey, size: number, lineGap = 1.5) => {
      doc.font(f[font]).fontSize(size);
      return doc.heightOfString(s, { width, lineGap });
    };
    const label = (s: string, x: number, y: number, color = C.peach) => text(s.toUpperCase(), x, y, { font: "sansBold", size: 7, color, spacing: 1.3 });
    const hair = (x1: number, x2: number, y: number, color = C.border) => doc.moveTo(x1, y).lineTo(x2, y).lineWidth(0.7).strokeColor(color).stroke();

    /** A running stitch along a gentle wave — the storefront's yarn motif. */
    const stitchWave = (x1: number, x2: number, y: number, color: string, opacity = 1) => {
      const w = x2 - x1;
      doc.save().opacity(opacity);
      doc
        .moveTo(x1, y)
        .bezierCurveTo(x1 + w * 0.18, y - 9, x1 + w * 0.32, y + 9, x1 + w * 0.5, y)
        .bezierCurveTo(x1 + w * 0.68, y - 9, x1 + w * 0.82, y + 9, x2, y)
        .lineWidth(1.4)
        .dash(5, { space: 4 })
        .lineCap("round")
        .strokeColor(color)
        .stroke()
        .undash();
      doc.restore();
    };

    /* ---------- header band ---------- */
    const drawHeader = () => {
      const bandH = 160;
      doc.rect(0, 0, W, bandH).fill(C.ink);
      // soft decorative rings, top right
      doc.save().opacity(0.14);
      doc.circle(W - 40, 18, 120).lineWidth(22).strokeColor(C.violet).stroke();
      doc.circle(W - 40, 18, 70).lineWidth(1).strokeColor(C.peach).stroke();
      doc.restore();
      stitchWave(M, R, bandH - 18, C.peach, 0.85);

      // logo badge + business
      const badge = 58;
      doc.circle(M + badge / 2, 42 + badge / 2, badge / 2).fill(C.white);
      if (logo) {
        try {
          doc.image(logo, M + 6, 42 + 6, { fit: [badge - 12, badge - 12], align: "center", valign: "center" });
        } catch {
          /* unsupported image — badge stays plain */
        }
      }
      const bx = M + badge + 14;
      text(snapshot.business.name || "Suthrayaa", bx, 44, { font: "serif", size: 22, color: C.white });
      text("Handcrafted crochet, made to order", bx, 72, { font: "serifItalic", size: 9.5, color: C.lilacText });
      const contact = [
        clean(snapshot.business.address)?.replace(/\n+/g, ", "),
        [clean(snapshot.business.email), clean(snapshot.business.phone)].filter(Boolean).join("  ·  "),
        snapshot.business.gstin ? `GSTIN ${snapshot.business.gstin}` : snapshot.business.taxNumber ? `Tax No. ${snapshot.business.taxNumber}` : null,
      ].filter(Boolean) as string[];
      let cy = 104;
      for (const line of contact) {
        text(line, M, cy, { size: 8, color: "#D9D2F5", width: 300 });
        cy += 11.5;
      }

      // invoice meta (right)
      const mx = R - 200;
      text(snapshot.business.gstin ? "TAX INVOICE" : "INVOICE", mx, 44, { font: "sansBold", size: 8, color: C.peach, width: 200, align: "right", spacing: 2 });
      text(invoiceNumber, mx, 58, { font: "serif", size: 19, color: C.white, width: 200, align: "right" });
      text(`Issued ${formatDate(snapshot.orderDate)}`, mx, 86, { size: 8.5, color: "#D9D2F5", width: 200, align: "right" });
      text(`Order #${snapshot.orderNumber}`, mx, 99, { size: 8.5, color: "#D9D2F5", width: 200, align: "right" });

      const st = statusStyle(livePaymentStatus || "pending");
      const pill = titleCase(livePaymentStatus || "pending").toUpperCase();
      doc.font(f.sansBold).fontSize(7.5);
      const pw = doc.widthOfString(pill, { characterSpacing: 1 }) + 22;
      doc.roundedRect(R - pw, 116, pw, 19, 9.5).fill(st.bg);
      doc.circle(R - pw + 10, 125.5, 2.4).fill(st.fg);
      text(pill, R - pw + 16, 121.5, { font: "sansBold", size: 7.5, color: st.fg, spacing: 1 });
      return bandH;
    };

    /** Slim header for continuation pages. */
    const drawContinuationHeader = () => {
      doc.rect(0, 0, W, 54).fill(C.ink);
      stitchWave(M, R, 46, C.peach, 0.6);
      text(snapshot.business.name || "Suthrayaa", M, 17, { font: "serif", size: 13, color: C.white });
      text(`${invoiceNumber}  ·  Order #${snapshot.orderNumber}  ·  continued`, R - 300, 20, { size: 8, color: "#D9D2F5", width: 300, align: "right" });
      return 78;
    };

    /* ---------- parties ---------- */
    let y = drawHeader() + 22;

    const addr = snapshot.shippingAddress ?? {};
    const shipName = clean(`${addr.firstName ?? ""} ${addr.lastName ?? ""}`) ?? clean(addr.fullName) ?? snapshot.customerName;
    const columns = [
      { title: "Billed to", head: snapshot.customerName, lines: [clean(snapshot.customerEmail), clean(snapshot.customerPhone)] },
      {
        title: "Ship to",
        head: shipName,
        lines: [
          clean(addr.addressLine1 ?? addr.address),
          clean(addr.addressLine2 ?? addr.apartment),
          clean(addr.landmark),
          [clean(addr.city), clean(addr.state)].filter(Boolean).join(", ") + (clean(addr.pincode) ? ` ${addr.pincode}` : ""),
          clean(addr.country),
          clean(addr.phone) ?? clean(snapshot.customerPhone),
        ],
      },
      {
        title: "Order",
        head: `#${snapshot.orderNumber}`,
        lines: [`Placed ${formatDate(snapshot.orderDate)}`, `Status: ${titleCase(liveStatus || "confirmed")}`, `Payment: ${paymentMethodLabel(snapshot.paymentMethod)}`],
      },
    ];
    const gap = 18;
    const colW = (CW - gap * 2) / 3;
    let colsH = 0;
    columns.forEach((col, i) => {
      const x = M + i * (colW + gap);
      if (i > 0) doc.moveTo(x - gap / 2, y).lineTo(x - gap / 2, y + 80).lineWidth(0.7).strokeColor(C.border).stroke();
      label(col.title, x, y);
      text(col.head, x, y + 14, { font: "sansSemi", size: 10.5, color: C.text, width: colW });
      let ly = y + 14 + height(col.head, colW, "sansSemi", 10.5) + 3;
      for (const line of col.lines.filter((l): l is string => !!l && l.trim() !== "")) {
        text(line, x, ly, { size: 8.5, color: C.muted, width: colW });
        ly += height(line, colW, "sans", 8.5) + 1;
      }
      colsH = Math.max(colsH, ly - y);
    });
    y += Math.max(colsH, 80) + 18;

    /* ---------- items table ---------- */
    const showSku = snapshot.business.showSku;
    const col = { idx: M + 12, item: M + 34, qty: R - 190, unit: R - 150, amount: R - 90 };
    const itemW = col.qty - col.item - 12;

    const drawTableHead = () => {
      doc.roundedRect(M, y, CW, 26, 8).fill(C.violetSoft);
      const hy = y + 9.5;
      text("#", col.idx, hy, { font: "sansBold", size: 7, color: C.ink, spacing: 1 });
      text("ITEM", col.item, hy, { font: "sansBold", size: 7, color: C.ink, spacing: 1 });
      text("QTY", col.qty, hy, { font: "sansBold", size: 7, color: C.ink, spacing: 1, width: 30, align: "center" });
      text("UNIT PRICE", col.unit, hy, { font: "sansBold", size: 7, color: C.ink, spacing: 1, width: 58, align: "right" });
      text("AMOUNT", col.amount, hy, { font: "sansBold", size: 7, color: C.ink, spacing: 1, width: 78, align: "right" });
      y += 26;
    };

    const newPage = () => {
      doc.addPage({ size: "A4", margin: 0 });
      y = drawContinuationHeader();
    };

    drawTableHead();
    snapshot.items.forEach((item, i) => {
      const details: string[] = [];
      for (const c of item.customizations ?? []) {
        const value = clean(c.valueLabel) ?? clean(c.textValue);
        if (!value && !c.label) continue;
        let line = value ? `${c.label}: ${value}` : c.label;
        if (snapshot.business.showCustomizationPricing && c.priceAdjustment) line += `  (${c.priceAdjustment > 0 ? "+" : "−"}${fmt(c.priceAdjustment)})`;
        details.push(line);
      }
      const detailText = details.join("\n");
      const nameH = height(item.name, itemW, "sansSemi", 10);
      const detailH = detailText ? height(detailText, itemW, "sans", 8.2) + 3 : 0;
      const skuH = showSku && item.sku ? 12 : 0;
      const rowH = Math.max(nameH + detailH + skuH + 22, 38);

      if (y + rowH > BOTTOM) {
        newPage();
        drawTableHead();
      }
      const ty = y + 11;
      text(String(i + 1).padStart(2, "0"), col.idx, ty + 1, { font: "sans", size: 8, color: C.faint });
      text(item.name, col.item, ty, { font: "sansSemi", size: 10, color: C.text, width: itemW });
      let dy = ty + nameH + 2;
      if (detailText) {
        text(detailText, col.item, dy, { size: 8.2, color: C.muted, width: itemW, lineGap: 2 });
        dy += detailH;
      }
      if (showSku && item.sku) text(`SKU ${item.sku}`, col.item, dy, { size: 7.2, color: C.faint, width: itemW, spacing: 0.3 });
      text(String(item.quantity), col.qty, ty + 1, { size: 9.5, width: 30, align: "center" });
      text(fmt(item.unitPrice), col.unit, ty + 1, { size: 9.5, width: 58, align: "right", color: C.muted });
      text(fmt(item.lineTotal), col.amount, ty + 1, { font: "sansSemi", size: 10, width: 78, align: "right" });
      y += rowH;
      hair(M, R, y);
    });

    /* ---------- totals ---------- */
    type Row = { label: string; value: string; color?: string };
    const rows: Row[] = [{ label: "Subtotal", value: fmt(snapshot.subtotal) }];
    if (snapshot.discountAmount > 0) rows.push({ label: "Discount", value: `−${fmt(snapshot.discountAmount)}`, color: C.green });
    rows.push({ label: "Shipping", value: snapshot.shippingCost > 0 ? fmt(snapshot.shippingCost) : "Free", color: snapshot.shippingCost > 0 ? undefined : C.green });
    if (snapshot.giftWrapCost > 0) rows.push({ label: "Gift wrap", value: fmt(snapshot.giftWrapCost) });

    const taxLines: Row[] = [];
    if (snapshot.business.showTax && snapshot.taxAmount > 0) {
      if (snapshot.igstAmount > 0) taxLines.push({ label: "IGST", value: fmt(snapshot.igstAmount) });
      if (snapshot.cgstAmount > 0) taxLines.push({ label: "CGST", value: fmt(snapshot.cgstAmount) });
      if (snapshot.sgstAmount > 0) taxLines.push({ label: "SGST", value: fmt(snapshot.sgstAmount) });
    }
    // Inclusive GST leaves the total unchanged; exclusive GST adds it on top.
    const preTax = snapshot.subtotal - snapshot.discountAmount + snapshot.shippingCost + snapshot.giftWrapCost;
    const taxInclusive = taxLines.length > 0 && Math.abs(snapshot.total - preTax) < 0.5;
    if (!taxInclusive) rows.push(...taxLines);

    const blockH = rows.length * 19 + 64 + (taxInclusive ? 16 : 0);
    if (y + 16 + blockH > BOTTOM) newPage();
    y += 16;

    const tx = R - 230;
    const top = y;
    for (const r of rows) {
      text(r.label, tx, y, { size: 9, color: C.muted, width: 120 });
      text(r.value, tx + 110, y, { font: "sansSemi", size: 9.5, color: r.color ?? C.text, width: 120, align: "right" });
      y += 19;
    }
    y += 4;
    doc.roundedRect(tx - 12, y, 242, 44, 12).fill(C.ink);
    text("TOTAL", tx, y + 17, { font: "sansBold", size: 8, color: C.lilacText, spacing: 1.6 });
    text(fmt(snapshot.total), tx + 60, y + 11, { font: "serif", size: 19, color: C.white, width: 160, align: "right" });
    y += 44;
    if (taxInclusive) {
      y += 6;
      text(`Includes ${taxLines.map((t) => `${t.label} ${t.value}`).join(" · ")}`, tx, y, { size: 7.8, color: C.muted, width: 230, align: "right" });
      y += 12;
    }

    // left of totals: amount in words + payment
    const lx = M;
    const lw = tx - M - 36;
    label("Amount in words", lx, top);
    text(currency === "INR" ? amountInWords(snapshot.total) : `${fmt(snapshot.total)} only`, lx, top + 13, { font: "serifItalic", size: 10.5, color: C.text, width: lw, lineGap: 2 });
    const py = top + 13 + height(currency === "INR" ? amountInWords(snapshot.total) : fmt(snapshot.total), lw, "serifItalic", 10.5, 2) + 16;
    doc.roundedRect(lx, py, lw, 44, 10).fill(C.lilacBg);
    label("Payment", lx + 14, py + 10, C.violet);
    text(`${paymentMethodLabel(snapshot.paymentMethod)}  ·  ${titleCase(livePaymentStatus || "pending")}`, lx + 14, py + 23, { font: "sansSemi", size: 9.5, width: lw - 28 });
    y = Math.max(y, py + 44) + 14;

    /* ---------- terms ---------- */
    const terms = clean(snapshot.business.terms);
    if (terms) {
      const th = height(terms, CW, "sans", 7.8, 2) + 24;
      if (y + th > BOTTOM) newPage();
      hair(M, R, y);
      label("Terms", M, y + 10, C.violet);
      text(terms, M, y + 22, { size: 7.8, color: C.muted, width: CW, lineGap: 2 });
    }

    /* ---------- footer on every page ---------- */
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      const fy = H - FOOTER_H;
      doc.rect(0, fy, W, FOOTER_H).fill(C.lilacBg);
      stitchWave(M, R, fy, C.violet, 0.35);
      const thanks = clean(snapshot.business.footer) ?? `Thank you for supporting handmade · ${snapshot.business.name || "Suthrayaa"}`;
      text(thanks, M, fy + 20, { font: "serifItalic", size: 9.5, color: C.ink, width: CW - 130 });
      text("This is a computer-generated invoice and needs no signature.", M, fy + 40, { size: 7, color: C.faint, width: CW - 130 });
      text(`Page ${p - range.start + 1} of ${range.count}`, R - 120, fy + 24, { font: "sansSemi", size: 8, color: C.muted, width: 120, align: "right" });
    }

    doc.end();
  });
}
