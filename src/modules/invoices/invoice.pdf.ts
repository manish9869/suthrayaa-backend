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

/** The storefront footer's white logo, for the dark header band (no badge behind it). */
async function whiteLogoBuffer(): Promise<Buffer | null> {
  const file = ASSET_DIR ? path.join(ASSET_DIR, "logo-white.png") : null;
  if (!file || !existsSync(file)) return null;
  const { readFile } = await import("node:fs/promises");
  return readFile(file);
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

function money(amount: number, currency: string, rupee: boolean, paise = false) {
  const n = Math.abs(Number(amount) || 0);
  const hasPaise = paise || Math.round(n * 100) % 100 !== 0;
  const digits = n.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 });
  if (currency === "INR") return rupee ? `₹${digits}` : `Rs. ${digits}`;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${digits}`;
  }
}

/** "9984112400" / "+919984112400" → "+91 99841 12400"; anything else is returned as-is. */
function formatPhone(v: unknown): string | null {
  const raw = clean(v);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return local.length === 10 ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : raw;
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

/** 5 → "5%", 2.5 → "2.5%". */
function pct(rate: number) {
  return `${Number(rate.toFixed(2))}%`;
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
  const whiteLogo = await whiteLogoBuffer();
  const logo = whiteLogo ? null : await fetchLogoBuffer(snapshot.business.logoUrl);
  const gst = snapshot.gst ?? null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: `Invoice ${invoiceNumber}`, Author: snapshot.business.name || "Suthrayaa" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { f, rupee } = registerFonts(doc);
    const currency = snapshot.business.currency || "INR";
    const fmt = (n: number) => money(n, currency, rupee);
    /** Always with paise — for tax figures, which are rarely whole rupees. */
    const fmt2 = (n: number) => money(n, currency, rupee, true);

    const W = doc.page.width;
    const H = doc.page.height;
    const M = 44;
    const R = W - M;
    const CW = R - M;
    const FOOTER_H = 64;
    const BOTTOM = H - FOOTER_H - 8;

    const text = (s: string, x: number, y: number, o: { font?: FontKey; size?: number; color?: string; width?: number; align?: "left" | "right" | "center"; spacing?: number; lineGap?: number; tnum?: boolean } = {}) => {
      doc.font(f[o.font ?? "sans"]).fontSize(o.size ?? 9).fillColor(o.color ?? C.text);
      doc.text(s, x, y, {
        width: o.width,
        align: o.align ?? "left",
        characterSpacing: o.spacing ?? 0,
        lineGap: o.lineGap ?? 1.5,
        lineBreak: o.width !== undefined,
        // tabular figures keep digits the same width, so numeric columns line up
        ...(o.tnum && rupee ? { features: ["tnum"] as any } : {}),
      });
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
      const idLine = gst
        ? [`GSTIN ${gst.gstin}`, gst.pan ? `PAN ${gst.pan}` : null, gst.supplierState ? `${gst.supplierState}${gst.supplierStateCode ? ` (${gst.supplierStateCode})` : ""}` : null]
            .filter(Boolean)
            .join("  ·  ")
        : snapshot.business.gstin
          ? `GSTIN ${snapshot.business.gstin}`
          : snapshot.business.taxNumber
            ? `Tax No. ${snapshot.business.taxNumber}`
            : null;
      const contact = [
        gst?.legalName && gst.legalName !== snapshot.business.name ? gst.legalName : null,
        clean(snapshot.business.address)?.replace(/\n+/g, ", "),
        [clean(snapshot.business.email), formatPhone(snapshot.business.phone)].filter(Boolean).join("  ·  "),
        idLine,
      ].filter(Boolean) as string[];
      const bandH = 160;
      doc.rect(0, 0, W, bandH).fill(C.ink);
      // soft decorative rings, top right
      doc.save().opacity(0.14);
      doc.circle(W - 40, 18, 120).lineWidth(22).strokeColor(C.violet).stroke();
      doc.circle(W - 40, 18, 70).lineWidth(1).strokeColor(C.peach).stroke();
      doc.restore();
      stitchWave(M, R, bandH - 14, C.peach, 0.85);

      // logo + business: the footer's white logo straight on the ink band
      const badge = 58;
      if (whiteLogo) {
        try {
          doc.image(whiteLogo, M - 2, 30, { fit: [badge + 4, badge + 4], align: "center", valign: "center" });
        } catch {
          /* unsupported image — name alone */
        }
      } else {
        doc.circle(M + badge / 2, 32 + badge / 2, badge / 2).fill(C.white);
        if (logo) {
          try {
            doc.image(logo, M + 6, 32 + 6, { fit: [badge - 12, badge - 12], align: "center", valign: "center" });
          } catch {
            /* unsupported image — badge stays plain */
          }
        }
      }
      const bx = M + badge + 14;
      text(snapshot.business.name || "Suthrayaa", bx, 36, { font: "serif", size: 22, color: C.white });
      text("Handcrafted crochet, made to order", bx, 64, { font: "serifItalic", size: 9.5, color: C.lilacText });
      let cy = contact.length >= 4 ? 90 : 96;
      for (const line of contact.slice(0, 4)) {
        text(line, M, cy, { size: 8, color: "#D9D2F5", width: 310 });
        cy += 11;
      }

      // invoice meta (right)
      const mx = R - 200;
      text(gst ? "TAX INVOICE" : "INVOICE", mx, 36, { font: "sansBold", size: 8, color: C.peach, width: 200, align: "right", spacing: 2 });
      if (gst) text("Original for recipient", mx, 48, { size: 7.5, color: C.lilacText, width: 200, align: "right" });
      text(invoiceNumber, mx, 60, { font: "serif", size: 19, color: C.white, width: 200, align: "right" });
      text(`Invoice date ${formatDate(snapshot.orderDate)}`, mx, 88, { size: 8.5, color: "#D9D2F5", width: 200, align: "right" });
      text(`Order #${snapshot.orderNumber}`, mx, 101, { size: 8.5, color: "#D9D2F5", width: 200, align: "right" });

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
      { title: "Billed to", head: snapshot.customerName, lines: [clean(snapshot.customerEmail), formatPhone(snapshot.customerPhone)] },
      {
        title: "Ship to",
        head: shipName,
        lines: [
          clean(addr.addressLine1 ?? addr.address),
          clean(addr.addressLine2 ?? addr.apartment),
          clean(addr.landmark),
          ...(gst?.placeOfSupplyCode
            ? [
                [clean(addr.city), clean(addr.pincode)].filter(Boolean).join(" "),
                `${clean(addr.state) ?? gst.placeOfSupply ?? ""}  ·  State code ${gst.placeOfSupplyCode}`,
              ]
            : [[clean(addr.city), clean(addr.state)].filter(Boolean).join(", ") + (clean(addr.pincode) ? ` ${addr.pincode}` : "")]),
          clean(addr.country),
          formatPhone(addr.phone) !== formatPhone(snapshot.customerPhone) ? formatPhone(addr.phone) : null,
        ],
      },
      gst
        ? {
            title: "Place of supply",
            head: `${gst.placeOfSupply ?? "—"}${gst.placeOfSupplyCode ? ` (${gst.placeOfSupplyCode})` : ""}`,
            lines: [
              `${gst.isInterState ? "Inter-state supply · IGST" : "Intra-state supply · CGST + SGST"}`,
              "Reverse charge: No",
              `Payment: ${paymentMethodLabel(snapshot.paymentMethod)} · ${titleCase(livePaymentStatus || "pending")}`,
            ],
          }
        : {
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
      label(col.title, x, y);
      text(col.head, x, y + 14, { font: "sansSemi", size: 10.5, color: C.text, width: colW });
      let ly = y + 14 + height(col.head, colW, "sansSemi", 10.5) + 3;
      for (const line of col.lines.filter((l): l is string => !!l && l.trim() !== "")) {
        text(line, x, ly, { size: 8.5, color: C.muted, width: colW });
        ly += height(line, colW, "sans", 8.5) + 1;
      }
      colsH = Math.max(colsH, ly - y);
    });
    colsH = Math.max(colsH, 60);
    for (let i = 1; i < columns.length; i++) {
      const x = M + i * (colW + gap) - gap / 2;
      doc.moveTo(x, y).lineTo(x, y + colsH).lineWidth(0.7).strokeColor(C.border).stroke();
    }
    y += colsH + 18;

    // items caption: "2 items · 4 units"
    const units = snapshot.items.reduce((a, it) => a + (Number(it.quantity) || 0), 0);
    label("Order items", M, y);
    text(`${snapshot.items.length} ${snapshot.items.length === 1 ? "item" : "items"}  ·  ${units} ${units === 1 ? "unit" : "units"}`, R - 200, y - 0.5, { size: 7.8, color: C.muted, width: 200, align: "right" });
    y += 14;

    /* ---------- items table ---------- */
    const showSku = snapshot.business.showSku;
    const NUM_R = R - 12; // right edge shared by every amount on the page
    const showHsn = !!gst && gst.lines.some((l) => l.hsn);
    // Columns laid out from the right edge so every numeric column is right-aligned on a grid
    const cw = { amount: 76, gst: 34, unit: 64, qty: 28, hsn: 44 };
    const col = { idx: M + 12, item: M + 38, amount: NUM_R - cw.amount, gst: 0, unit: 0, qty: 0, hsn: 0 };
    col.gst = col.amount - 8 - cw.gst;
    col.unit = (gst ? col.gst : col.amount) - 8 - cw.unit;
    col.qty = col.unit - 8 - cw.qty;
    col.hsn = col.qty - 8 - cw.hsn;
    const itemW = (showHsn ? col.hsn : col.qty) - col.item - 12;

    const drawTableHead = () => {
      doc.roundedRect(M, y, CW, 26, 8).fill(C.violetSoft);
      const hy = y + 9.5;
      const th = (s: string, x: number, w?: number, align: "left" | "right" | "center" = "left") =>
        text(s, x, hy, { font: "sansBold", size: 7, color: C.ink, spacing: 1, width: w, align });
      th("#", col.idx);
      th("ITEM", col.item);
      if (showHsn) th("HSN", col.hsn, cw.hsn, "center");
      th("QTY", col.qty, cw.qty, "center");
      th(gst?.pricesIncludeGst ? "RATE" : "UNIT PRICE", col.unit, cw.unit, "right");
      if (gst) th("GST", col.gst, cw.gst, "right");
      th("AMOUNT", col.amount, cw.amount, "right");
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
      const rowH = Math.max(nameH + detailH + skuH + 16, 34);

      if (y + rowH > BOTTOM) {
        newPage();
        drawTableHead();
      }
      const ty = y + 8;
      const line = gst?.lines[i];
      text(String(i + 1).padStart(2, "0"), col.idx, ty + 1.6, { font: "sans", size: 8, color: C.faint, tnum: true });
      text(item.name, col.item, ty, { font: "sansSemi", size: 10, color: C.text, width: itemW });
      let dy = ty + nameH + 2;
      if (detailText) {
        text(detailText, col.item, dy, { size: 8.2, color: C.muted, width: itemW, lineGap: 2 });
        dy += detailH;
      }
      if (showSku && item.sku) text(`SKU ${item.sku}`, col.item, dy, { size: 7.2, color: C.faint, width: itemW, spacing: 0.3 });
      if (showHsn) text(line?.hsn ?? "—", col.hsn, ty + 0.9, { size: 8.5, width: cw.hsn, align: "center", color: C.muted, tnum: true });
      text(String(item.quantity), col.qty, ty + 0.4, { size: 9.5, width: cw.qty, align: "center", tnum: true });
      text(fmt(item.unitPrice), col.unit, ty + 0.4, { size: 9.5, width: cw.unit, align: "right", color: C.muted, tnum: true });
      if (gst) text(line ? `${pct(line.ratePercent)}` : "—", col.gst, ty + 0.9, { size: 8.5, width: cw.gst, align: "right", color: C.muted, tnum: true });
      text(fmt(item.lineTotal), col.amount, ty, { font: "sansSemi", size: 10, width: cw.amount, align: "right", tnum: true });
      y += rowH;
      hair(M, R, y);
    });
    if (gst?.pricesIncludeGst) {
      text("All prices are inclusive of GST.", M, y + 6, { size: 7.5, color: C.faint });
    }

    /* ---------- totals ---------- */
    type Row = { label: string; value: string; color?: string };
    const rows: Row[] = [{ label: "Subtotal", value: fmt(snapshot.subtotal) }];
    if (snapshot.discountAmount > 0) rows.push({ label: "Discount", value: `−${fmt(snapshot.discountAmount)}`, color: C.green });
    rows.push({ label: "Shipping", value: snapshot.shippingCost > 0 ? fmt(snapshot.shippingCost) : "Free", color: snapshot.shippingCost > 0 ? undefined : C.green });
    if (snapshot.giftWrapCost > 0) rows.push({ label: "Gift wrap", value: fmt(snapshot.giftWrapCost) });

    // Tax lines: the invoice's own GST breakdown when present, else the order-level figures
    const taxLines: Row[] = [];
    const tax = gst
      ? { igst: gst.igst, cgst: gst.cgst, sgst: gst.sgst, total: gst.totalTax }
      : { igst: snapshot.igstAmount, cgst: snapshot.cgstAmount, sgst: snapshot.sgstAmount, total: snapshot.taxAmount };
    if ((gst || snapshot.business.showTax) && tax.total > 0) {
      if (tax.igst > 0) taxLines.push({ label: "IGST", value: fmt2(tax.igst) });
      if (tax.cgst > 0) taxLines.push({ label: "CGST", value: fmt2(tax.cgst) });
      if (tax.sgst > 0) taxLines.push({ label: "SGST", value: fmt2(tax.sgst) });
    }
    // Inclusive GST leaves the total unchanged; exclusive GST adds it on top.
    const preTax = snapshot.subtotal - snapshot.discountAmount + snapshot.shippingCost + snapshot.giftWrapCost;
    const taxInclusive = gst ? gst.pricesIncludeGst : taxLines.length > 0 && Math.abs(snapshot.total - preTax) < 0.5;
    if (!taxInclusive) rows.push(...taxLines);
    if (gst && Math.abs(gst.roundOff) >= 0.01) rows.push({ label: "Round off", value: `${gst.roundOff < 0 ? "−" : ""}${fmt2(gst.roundOff)}` });

    const tx = R - 222; // right column: totals labels; the total panel starts 12pt left of this
    const LW = tx - 12 - 24 - M; // left column width
    const words = currency === "INR" ? amountInWords(snapshot.total) : `${fmt(snapshot.total)} only`;
    const summaryH = gst ? 14 + 20 + (gst.summary.length + 1) * 18 + 28 + 13 + height(words, LW, "serifItalic", 10, 2) : 0;
    const rightH = rows.length * 18 + 4 + 46 + (taxInclusive && taxLines.length ? 18 : 0);
    const blockH = Math.max(rightH, summaryH, gst ? 0 : 110);
    if (y + 20 + blockH > BOTTOM) newPage();
    y += 20;

    const top = y;
    for (const r of rows) {
      text(r.label, tx, y, { size: 9, color: C.muted, width: 120 });
      text(r.value, NUM_R - 130, y, { font: "sansSemi", size: 9.5, color: r.color ?? C.text, width: 130, align: "right", tnum: true });
      y += 18;
    }
    y += 4;
    const panelY = y;
    doc.roundedRect(tx - 12, y, R - (tx - 12), 46, 12).fill(C.ink);
    text(gst ? "TOTAL (INCL. GST)" : "TOTAL", tx, y + 18.5, { font: "sansBold", size: 8, color: C.lilacText, spacing: 1.4 });
    text(fmt(snapshot.total), NUM_R - 150, y + 12, { font: "serif", size: 19, color: C.white, width: 150, align: "right", tnum: true });
    y += 46;
    if (taxInclusive && taxLines.length) {
      y += 6;
      text(`Includes ${taxLines.map((t) => `${t.label} ${t.value}`).join(" · ")}`, tx - 12, y, { size: 7.8, color: C.muted, width: NUM_R - (tx - 12), align: "right", tnum: true });
      y += 12;
    }

    if (gst) {
      // left column: HSN-wise GST summary
      const inter = gst.isInterState;
      let sy = top;
      label("GST summary", M, sy, C.violet);
      sy += 14;
      const end = M + LW - 8;
      const sc = inter
        ? { igst: end - 66, taxable: end - 66 - 8 - 70, cgst: 0, sgst: 0, wTax: 66, wTaxable: 70 }
        : { sgst: end - 54, cgst: end - 54 - 6 - 54, taxable: end - 54 - 6 - 54 - 6 - 64, igst: 0, wTax: 54, wTaxable: 64 };
      const hsnW = sc.taxable - (M + 8) - 4;
      doc.roundedRect(M, sy, LW, 20, 6).fill(C.lilacBg);
      const sh = (s: string, x: number, width: number, align: "left" | "right" = "right") =>
        text(s, x, sy + 7, { font: "sansBold", size: 6.4, color: C.ink, spacing: 0.8, width, align });
      sh("HSN · RATE", M + 8, hsnW, "left");
      sh("TAXABLE", sc.taxable, sc.wTaxable);
      if (inter) sh("IGST", sc.igst, sc.wTax);
      else {
        sh("CGST", sc.cgst, sc.wTax);
        sh("SGST", sc.sgst, sc.wTax);
      }
      sy += 20;
      const cell = (s: string, x: number, width: number, o: { bold?: boolean; color?: string; align?: "left" | "right" } = {}) =>
        text(s, x, sy + 5, { font: o.bold ? "sansSemi" : "sans", size: 8, color: o.color ?? C.text, width, align: o.align ?? "right", tnum: true });
      for (const r of gst.summary) {
        cell(r.hsn ? `${r.hsn}  ·  ${pct(r.ratePercent)}` : pct(r.ratePercent), M + 8, hsnW, { align: "left" });
        cell(fmt2(r.taxableValue), sc.taxable, sc.wTaxable);
        if (inter) cell(fmt2(r.igst), sc.igst, sc.wTax);
        else {
          cell(fmt2(r.cgst), sc.cgst, sc.wTax);
          cell(fmt2(r.sgst), sc.sgst, sc.wTax);
        }
        sy += 18;
        hair(M, M + LW, sy);
      }
      cell("Total", M + 8, hsnW, { align: "left", bold: true });
      cell(fmt2(gst.taxableValue), sc.taxable, sc.wTaxable, { bold: true });
      if (inter) cell(fmt2(gst.igst), sc.igst, sc.wTax, { bold: true, color: C.violet });
      else {
        cell(fmt2(gst.cgst), sc.cgst, sc.wTax, { bold: true, color: C.violet });
        cell(fmt2(gst.sgst), sc.sgst, sc.wTax, { bold: true, color: C.violet });
      }
      sy += 20;
      const note = [
        `Total GST ${fmt2(gst.totalTax)}`,
        inter ? null : "CGST & SGST at half the rate each",
        gst.charges.length ? `${gst.charges.map((c) => (c.label ?? "charges").toLowerCase()).join(" & ")} at the principal item's rate` : null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      text(note.charAt(0).toUpperCase() + note.slice(1), M, sy, { size: 7, color: C.faint, width: LW, lineGap: 1.5 });
      sy += height(note, LW, "sans", 7) + 12;
      // amount in words under the summary
      label("Amount in words", M, sy);
      text(words, M, sy + 13, { font: "serifItalic", size: 10, color: C.text, width: LW, lineGap: 2 });
      sy += 13 + height(words, LW, "serifItalic", 10, 2);
      y = Math.max(y, sy) + 8;
    } else {
      // left of totals: amount in words + payment
      const lw = tx - 12 - M - 28;
      label("Amount in words", M, top);
      text(words, M, top + 13, { font: "serifItalic", size: 10.5, color: C.text, width: lw, lineGap: 2 });
      const wordsBottom = top + 13 + height(words, lw, "serifItalic", 10.5, 2);
      const py = Math.max(panelY, wordsBottom + 14);
      doc.roundedRect(M, py, lw, 46, 12).fill(C.lilacBg);
      label("Payment", M + 14, py + 11, C.violet);
      text(`${paymentMethodLabel(snapshot.paymentMethod)}  ·  ${titleCase(livePaymentStatus || "pending")}`, M + 14, py + 24, { font: "sansSemi", size: 9.5, width: lw - 28 });
      y = Math.max(y, py + 46) + 14;
      if (!snapshot.business.gstin && tax.total <= 0 && snapshot.business.showTax) {
        text("GST not charged — the supplier is not registered under GST.", M, y, { size: 7.8, color: C.faint, width: CW });
        y += 16;
      }
    }

    const terms = clean(snapshot.business.terms);

    /* ---------- declaration, terms + authorised signatory (tax invoices) ---------- */
    if (gst) {
      const dw = CW - 196;
      const decl = "Certified that the particulars given above are true and correct. Tax is not payable on reverse charge basis.";
      const declH = height(decl, dw, "sans", 7.6, 1.8);
      const termsH = terms ? 22 + height(terms, dw, "sans", 7.6, 1.8) : 0;
      const bandH = Math.max(13 + declH + termsH, 62);
      if (y + 10 + bandH > BOTTOM) newPage();
      hair(M, R, y);
      y += 10;
      label("Declaration", M, y, C.violet);
      text(decl, M, y + 13, { size: 7.6, color: C.muted, width: dw, lineGap: 1.8 });
      if (terms) {
        const ty = y + 13 + declH + 9;
        label("Terms", M, ty, C.violet);
        text(terms, M, ty + 13, { size: 7.6, color: C.muted, width: dw, lineGap: 1.8 });
      }
      const sx = R - 170;
      text(`For ${gst.legalName || snapshot.business.name || "Suthrayaa"}`, sx, y, { font: "sansSemi", size: 8.8, color: C.text, width: 170, align: "right" });
      doc.moveTo(sx + 30, y + 42).lineTo(R, y + 42).lineWidth(0.7).strokeColor(C.faint).stroke();
      text("Authorised Signatory", sx, y + 47, { size: 7.8, color: C.muted, width: 170, align: "right" });
      y += bandH;
    } else if (terms) {
      /* ---------- terms ---------- */
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
      text(thanks, M, fy + 20, { font: "serifItalic", size: 9.5, color: C.ink, width: CW - 200 });
      text(
        gst ? "This is a computer-generated tax invoice." : "This is a computer-generated invoice and needs no signature.",
        M,
        fy + 38,
        { size: 7, color: C.faint, width: CW - 200 },
      );
      text(`Page ${p - range.start + 1} of ${range.count}`, R - 190, fy + 21.4, { font: "sansSemi", size: 8, color: C.muted, width: 190, align: "right" });
      const contactLine = [clean(snapshot.business.email), formatPhone(snapshot.business.phone)].filter(Boolean).join("  ·  ");
      if (contactLine) text(contactLine, R - 190, fy + 38, { size: 7, color: C.faint, width: 190, align: "right" });
    }

    doc.end();
  });
}
