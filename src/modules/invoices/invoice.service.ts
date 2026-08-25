import PDFDocument from "pdfkit";
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

interface InvoiceSnapshot {
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
   LOGO
   ============================================================ */

async function fetchLogoBuffer(
  logoUrl: string | null
): Promise<Buffer | null> {
  if (!logoUrl) return null;

  try {
    const res = await fetch(logoUrl);

    if (!res.ok) return null;

    const contentType =
      res.headers.get("content-type") ?? "";

    if (
      !contentType.includes("png") &&
      !contentType.includes("jpeg") &&
      !contentType.includes("jpg")
    ) {
      return null;
    }

    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/* ============================================================
   SUTHRAYAA BRAND
   ============================================================ */

const BRAND = {
  plum: "#3D2B35",
  plumSoft: "#5A4650",

  pink: "#D96C8A",
  pinkDark: "#C55376",
  pinkLight: "#FFF0F4",
  pinkVeryLight: "#FFF8FA",

  lavender: "#A77BCA",
  lavenderDark: "#936BB2",
  lavenderLight: "#F7F1FC",
  lavenderBorder: "#EADFF3",

  cream: "#FFF8F5",
  creamDark: "#F3E4DC",

  text: "#3D2B35",
  muted: "#8F7A85",
  mutedLight: "#A5949E",

  border: "#F0DFE7",

  green: "#579274",
  greenBg: "#E6F2EC",

  gold: "#C28A3E",
  goldBg: "#FFF0D8",

  red: "#A94A4A",
  redBg: "#FBE5E5",

  white: "#FFFFFF",
};

/* ============================================================
   PAYMENT STATUS
   ============================================================ */

function statusPillColors(paymentStatus: string): {
  bg: string;
  fg: string;
} {
  const status = paymentStatus.toLowerCase();

  if (
    status === "paid" ||
    status === "captured" ||
    status === "completed"
  ) {
    return {
      bg: BRAND.greenBg,
      fg: BRAND.green,
    };
  }

  if (
    status === "failed" ||
    status === "payment_failed"
  ) {
    return {
      bg: BRAND.redBg,
      fg: BRAND.red,
    };
  }

  if (
    status === "refunded" ||
    status === "partially_refunded"
  ) {
    return {
      bg: BRAND.goldBg,
      fg: BRAND.gold,
    };
  }

  return {
    bg: BRAND.lavenderLight,
    fg: BRAND.lavenderDark,
  };
}

/* ============================================================
   HELPERS
   ============================================================ */

function clean(value: unknown): string | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return String(value).trim();
}

function paymentMethodLabel(method: string | null | undefined) {
  const value = String(method ?? "").toLowerCase();

  if (value === "cod") {
    return "Cash on Delivery";
  }

  if (value === "razorpay") {
    return "Razorpay";
  }

  if (value === "upi") {
    return "UPI";
  }

  if (value === "card") {
    return "Card";
  }

  if (value === "netbanking") {
    return "Net Banking";
  }

  if (!value) {
    return "—";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusLabel(status: string) {
  return String(status || "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(date: string) {
  try {
    return new Date(date).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return date;
  }
}

function formatCurrency(
  amount: number,
  currency = "INR"
) {
  const abs = Math.abs(Number(amount) || 0);

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(abs);
  } catch {
    return `${currency} ${abs.toLocaleString("en-IN")}`;
  }
}

/* ============================================================
   DRAWING HELPERS
   ============================================================ */

function drawPageAccent(
  doc: PDFKit.PDFDocument,
  pageW: number
) {
  doc
    .rect(0, 0, pageW, 6)
    .fill(BRAND.pink);
}

function drawSectionLabel(
  doc: PDFKit.PDFDocument,
  label: string,
  x: number,
  y: number
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(BRAND.pink)
    .text(label.toUpperCase(), x, y, {
      characterSpacing: 1.4,
    });
}

function drawDivider(
  doc: PDFKit.PDFDocument,
  x1: number,
  x2: number,
  y: number
) {
  doc
    .moveTo(x1, y)
    .lineTo(x2, y)
    .strokeColor(BRAND.border)
    .lineWidth(0.8)
    .stroke();
}

/* ============================================================
   INVOICE PDF
   ============================================================ */

/**
 * Renders a stored invoice snapshot to a PDF buffer.
 *
 * Pricing/product/business information comes from the frozen snapshot.
 * Payment/order status is intentionally supplied live.
 */
export async function renderInvoicePdf(
  invoiceNumber: string,
  snapshot: InvoiceSnapshot,
  liveStatus: string,
  livePaymentStatus: string
): Promise<Buffer> {
  const logoBuffer = await fetchLogoBuffer(
    snapshot.business.logoUrl
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      autoFirstPage: true,
    });

    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));

    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    doc.on("error", reject);

    /* ----------------------------------------------------------
       PAGE CONSTANTS
       ---------------------------------------------------------- */

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    const left = 48;
    const right = pageW - 48;
    const contentW = right - left;

    const topMargin = 38;
    const bottomMargin = 54;

    const currency = snapshot.business.currency || "INR";

    /* ----------------------------------------------------------
       HEADER
       ---------------------------------------------------------- */

    drawPageAccent(doc, pageW);

    let headerTextX = left;

    if (logoBuffer) {
      try {
        doc
          .roundedRect(
            left,
            topMargin,
            56,
            56,
            12
          )
          .fill(BRAND.pinkVeryLight);

        doc.image(
          logoBuffer,
          left + 6,
          topMargin + 6,
          {
            fit: [44, 44],
          }
        );

        headerTextX = left + 72;
      } catch {
        headerTextX = left;
      }
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(19)
      .fillColor(BRAND.plum)
      .text(
        snapshot.business.name,
        headerTextX,
        topMargin + 2,
        {
          width: 250,
        }
      );

    const businessLines = [
      clean(snapshot.business.address),
      clean(snapshot.business.email),
      clean(snapshot.business.phone),
      snapshot.business.gstin
        ? `GSTIN: ${snapshot.business.gstin}`
        : snapshot.business.taxNumber
          ? `Tax No: ${snapshot.business.taxNumber}`
          : null,
    ].filter(Boolean) as string[];

    if (businessLines.length) {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(BRAND.muted)
        .text(
          businessLines.join("\n"),
          headerTextX,
          topMargin + 26,
          {
            width: 245,
            lineGap: 2,
          }
        );
    }

    /* ----------------------------------------------------------
       INVOICE META RIGHT
       ---------------------------------------------------------- */

    const metaX = left + 310;
    const metaW = contentW - 310;

    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(BRAND.lavenderDark)
      .text(
        "ORDER CONFIRMATION",
        metaX,
        topMargin,
        {
          width: metaW,
          align: "right",
          characterSpacing: 1.4,
        }
      );

    doc
      .font("Helvetica-Bold")
      .fontSize(25)
      .fillColor(BRAND.plum)
      .text(
        "INVOICE",
        metaX,
        topMargin + 13,
        {
          width: metaW,
          align: "right",
        }
      );

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(
        `Invoice No. ${invoiceNumber}`,
        metaX,
        topMargin + 45,
        {
          width: metaW,
          align: "right",
        }
      );

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND.muted)
      .text(
        `Order #${snapshot.orderNumber}`,
        metaX,
        topMargin + 59,
        {
          width: metaW,
          align: "right",
        }
      );

    /* ----------------------------------------------------------
       PAYMENT STATUS PILL
       ---------------------------------------------------------- */

    const pillLabel = String(
      livePaymentStatus || "pending"
    )
      .replace(/_/g, " ")
      .toUpperCase();

    const pillColors =
      statusPillColors(livePaymentStatus);

    doc
      .font("Helvetica-Bold")
      .fontSize(7);

    const pillW =
      Math.max(
        76,
        doc.widthOfString(pillLabel) + 24
      );

    const pillH = 20;

    const pillX = right - pillW;
    const pillY = topMargin + 77;

    doc
      .roundedRect(
        pillX,
        pillY,
        pillW,
        pillH,
        pillH / 2
      )
      .fill(pillColors.bg);

    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor(pillColors.fg)
      .text(
        pillLabel,
        pillX,
        pillY + 6,
        {
          width: pillW,
          align: "center",
        }
      );

    /* ----------------------------------------------------------
       INFO CARDS
       ---------------------------------------------------------- */

    let y = 132;

    drawDivider(doc, left, right, y);

    y += 20;

    const gap = 10;
    const cardW = (contentW - gap * 2) / 3;
    const cardH = 96;

    const customerAddress =
      snapshot.shippingAddress ?? {};

    const cards = [
      {
        x: left,
        label: "BILLED TO",
        title: snapshot.customerName,
        lines: [
          clean(snapshot.customerEmail),
          clean(snapshot.customerPhone),
        ].filter(Boolean) as string[],
      },

      {
        x: left + cardW + gap,
        label: "ORDER DETAILS",
        title: `#${snapshot.orderNumber}`,
        lines: [
          `Date: ${formatDate(snapshot.orderDate)}`,
          `Status: ${statusLabel(liveStatus)}`,
        ],
      },

      {
        x: left + (cardW + gap) * 2,
        label: "PAYMENT",
        title: paymentMethodLabel(
          snapshot.paymentMethod
        ),
        lines: [
          `Status: ${statusLabel(
            livePaymentStatus
          )}`,
        ],
      },
    ];

    for (const card of cards) {
      doc
        .roundedRect(
          card.x,
          y,
          cardW,
          cardH,
          12
        )
        .fill(BRAND.lavenderLight);

      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(BRAND.lavenderDark)
        .text(
          card.label,
          card.x + 14,
          y + 14,
          {
            characterSpacing: 1.2,
          }
        );

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(BRAND.plum)
        .text(
          card.title,
          card.x + 14,
          y + 29,
          {
            width: cardW - 28,
          }
        );

      if (card.lines.length) {
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.muted)
          .text(
            card.lines.join("\n"),
            card.x + 14,
            y + 46,
            {
              width: cardW - 28,
              lineGap: 2,
            }
          );
      }
    }

    y += cardH + 25;

    /* ----------------------------------------------------------
       SHIPPING ADDRESS
       ---------------------------------------------------------- */

    drawSectionLabel(
      doc,
      "Shipping To",
      left,
      y
    );

    y += 14;

    const addressLines = [
      snapshot.customerName,

      clean(customerAddress.addressLine1),

      clean(customerAddress.addressLine2),

      [
        customerAddress.city,
        customerAddress.state,
        customerAddress.pincode,
      ]
        .filter(Boolean)
        .join(", "),

      clean(customerAddress.country),

      customerAddress.phone
        ? `Phone: ${customerAddress.phone}`
        : snapshot.customerPhone
          ? `Phone: ${snapshot.customerPhone}`
          : null,
    ].filter(Boolean) as string[];

    const addressH = Math.max(
      68,
      25 + addressLines.length * 13
    );

    doc
      .roundedRect(
        left,
        y,
        contentW,
        addressH,
        12
      )
      .fill(BRAND.cream);

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(BRAND.plum)
      .text(
        addressLines[0] ?? snapshot.customerName,
        left + 16,
        y + 14
      );

    if (addressLines.length > 1) {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(BRAND.muted)
        .text(
          addressLines.slice(1).join("\n"),
          left + 16,
          y + 29,
          {
            width: contentW - 32,
            lineGap: 1.5,
          }
        );
    }

    y += addressH + 26;

    /* ----------------------------------------------------------
       ITEMS HEADER
       ---------------------------------------------------------- */

    drawSectionLabel(
      doc,
      "Order Items",
      left,
      y
    );

    y += 13;

    const tableHeaderH = 28;

    doc
      .roundedRect(
        left,
        y,
        contentW,
        tableHeaderH,
        7
      )
      .fill(BRAND.plum);

    const showSku =
      snapshot.business.showSku;

    const productX = left + 14;
    const skuX = left + 245;
    const qtyX = showSku
      ? left + 325
      : left + 315;

    const priceX = showSku
      ? left + 370
      : left + 365;

    const totalX =
      right - 92;

    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor(BRAND.white)
      .text(
        "PRODUCT",
        productX,
        y + 10
      );

    if (showSku) {
      doc.text(
        "SKU",
        skuX,
        y + 10
      );
    }

    doc.text(
      "QTY",
      qtyX,
      y + 10
    );

    doc.text(
      "PRICE",
      priceX,
      y + 10
    );

    doc.text(
      "TOTAL",
      totalX,
      y + 10,
      {
        width: 78,
        align: "right",
      }
    );

    y += tableHeaderH;

    /* ----------------------------------------------------------
       ITEMS
       ---------------------------------------------------------- */

    for (
      let index = 0;
      index < snapshot.items.length;
      index++
    ) {
      const item =
        snapshot.items[index];

      const itemStartY = y;

      const productWidth =
        showSku
          ? skuX - productX - 12
          : qtyX - productX - 12;

      /* Product name */
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(BRAND.plum)
        .text(
          item.name,
          productX,
          y + 13,
          {
            width: productWidth,
          }
        );

      /* SKU */
      if (showSku) {
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.muted)
          .text(
            item.sku || "—",
            skuX,
            y + 13,
            {
              width: 68,
            }
          );
      }

      /* Quantity */
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(BRAND.plumSoft)
        .text(
          String(item.quantity),
          qtyX,
          y + 13
        );

      /* Price */
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(BRAND.plumSoft)
        .text(
          formatCurrency(
            item.unitPrice,
            currency
          ),
          priceX,
          y + 13
        );

      /* Total */
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(BRAND.plum)
        .text(
          formatCurrency(
            item.lineTotal,
            currency
          ),
          totalX,
          y + 13,
          {
            width: 78,
            align: "right",
          }
        );

      y += 31;

      /* --------------------------------------------------------
         CUSTOMIZATIONS
         -------------------------------------------------------- */

      if (
        snapshot.business
          .showCustomizationPricing &&
        item.customizations?.length
      ) {
        for (const customization of item.customizations) {
          const value =
            customization.valueLabel ??
            customization.textValue ??
            "";

          if (!value && !customization.label) {
            continue;
          }

          let adjustment = "";

          if (
            customization.priceAdjustment
          ) {
            const sign =
              customization.priceAdjustment >
                0
                ? "+"
                : "-";

            adjustment = ` (${sign}${formatCurrency(
              Math.abs(
                customization.priceAdjustment
              ),
              currency
            )})`;
          }

          doc
            .font("Helvetica")
            .fontSize(7.5)
            .fillColor(BRAND.muted)
            .text(
              `${customization.label}: ${value}${adjustment}`,
              productX + 8,
              y,
              {
                width: 300,
              }
            );

          y += 12;
        }
      }

      const rowHeight =
        Math.max(
          31,
          y - itemStartY + 8
        );

      /*
       * Light alternating row background.
       */
      if (index % 2 === 0) {
        doc
          .save()
          .fillColor("#FFFAFD")
          .rect(
            left,
            itemStartY,
            contentW,
            rowHeight
          )
          .fill()
          .restore();
      }

      /*
       * Redraw item text after background.
       * This keeps the background behind the text.
       */
      if (index % 2 === 0) {
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor(BRAND.plum)
          .text(
            item.name,
            productX,
            itemStartY + 13,
            {
              width: productWidth,
            }
          );

        if (showSku) {
          doc
            .font("Helvetica")
            .fontSize(8)
            .fillColor(BRAND.muted)
            .text(
              item.sku || "—",
              skuX,
              itemStartY + 13,
              {
                width: 68,
              }
            );
        }

        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.plumSoft)
          .text(
            String(item.quantity),
            qtyX,
            itemStartY + 13
          );

        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(BRAND.plumSoft)
          .text(
            formatCurrency(
              item.unitPrice,
              currency
            ),
            priceX,
            itemStartY + 13
          );

        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor(BRAND.plum)
          .text(
            formatCurrency(
              item.lineTotal,
              currency
            ),
            totalX,
            itemStartY + 13,
            {
              width: 78,
              align: "right",
            }
          );
      }

      drawDivider(
        doc,
        left,
        right,
        y + 2
      );

      y += 10;

      /*
       * Page break if needed.
       */
      if (y > pageH - 170) {
        doc.addPage();

        drawPageAccent(
          doc,
          pageW
        );

        y = 48;

        drawSectionLabel(
          doc,
          "Order Items — Continued",
          left,
          y
        );

        y += 13;

        doc
          .roundedRect(
            left,
            y,
            contentW,
            tableHeaderH,
            7
          )
          .fill(BRAND.plum);

        doc
          .font("Helvetica-Bold")
          .fontSize(7)
          .fillColor(BRAND.white)
          .text(
            "PRODUCT",
            productX,
            y + 10
          );

        if (showSku) {
          doc.text(
            "SKU",
            skuX,
            y + 10
          );
        }

        doc.text(
          "QTY",
          qtyX,
          y + 10
        );

        doc.text(
          "PRICE",
          priceX,
          y + 10
        );

        doc.text(
          "TOTAL",
          totalX,
          y + 10,
          {
            width: 78,
            align: "right",
          }
        );

        y += tableHeaderH;
      }
    }

    /* ----------------------------------------------------------
       TOTALS
       ---------------------------------------------------------- */

    y += 18;

    if (y > pageH - 270) {
      doc.addPage();
      drawPageAccent(doc, pageW);
      y = 55;
    }

    drawSectionLabel(
      doc,
      "Order Summary",
      left,
      y
    );

    y += 15;

    const totalsX =
      right - 245;

    const totalsValueX =
      right - 100;

    const totalsWidth = 245;

    const totalsRows: Array<{
      label: string;
      amount: number;
      color?: string;
    }> = [
        {
          label: "Subtotal",
          amount: snapshot.subtotal,
        },
      ];

    if (snapshot.discountAmount > 0) {
      totalsRows.push({
        label: "Discount",
        amount: -snapshot.discountAmount,
        color: BRAND.green,
      });
    }

    totalsRows.push({
      label: "Shipping",
      amount: snapshot.shippingCost,
    });

    if (snapshot.giftWrapCost > 0) {
      totalsRows.push({
        label: "Gift Wrap",
        amount: snapshot.giftWrapCost,
      });
    }

    if (
      snapshot.business.showTax &&
      snapshot.taxAmount > 0
    ) {
      if (snapshot.igstAmount > 0) {
        totalsRows.push({
          label: `IGST`,
          amount: snapshot.igstAmount,
        });
      } else {
        if (snapshot.cgstAmount > 0) {
          totalsRows.push({
            label: "CGST",
            amount: snapshot.cgstAmount,
          });
        }

        if (snapshot.sgstAmount > 0) {
          totalsRows.push({
            label: "SGST",
            amount: snapshot.sgstAmount,
          });
        }
      }
    }

    for (const row of totalsRows) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(
          row.color ?? BRAND.muted
        )
        .text(
          row.label,
          totalsX,
          y,
          {
            width: 130,
          }
        );

      const amountPrefix =
        row.amount < 0 ? "- " : "";

      doc
        .font(
          row.amount < 0
            ? "Helvetica-Bold"
            : "Helvetica"
        )
        .fontSize(9)
        .fillColor(
          row.color ?? BRAND.plum
        )
        .text(
          `${amountPrefix}${formatCurrency(
            row.amount,
            currency
          )}`,
          totalsValueX,
          y,
          {
            width: 100,
            align: "right",
          }
        );

      y += 19;
    }

    y += 5;

    /* ----------------------------------------------------------
       TOTAL BAND
       ---------------------------------------------------------- */

    const totalBandH = 48;

    doc
      .roundedRect(
        totalsX,
        y,
        totalsWidth,
        totalBandH,
        10
      )
      .fill(BRAND.pinkLight);

    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(BRAND.pinkDark)
      .text(
        "TOTAL",
        totalsX + 15,
        y + 18,
        {
          characterSpacing: 1.3,
        }
      );

    doc
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(BRAND.pink)
      .text(
        formatCurrency(
          snapshot.total,
          currency
        ),
        totalsX + 15,
        y + 12,
        {
          width: totalsWidth - 30,
          align: "right",
        }
      );

    y += totalBandH + 25;

    /* ----------------------------------------------------------
       PAYMENT INFORMATION
       ---------------------------------------------------------- */

    doc
      .roundedRect(
        left,
        y,
        contentW,
        52,
        10
      )
      .fill(BRAND.lavenderLight);

    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(BRAND.lavenderDark)
      .text(
        "PAYMENT",
        left + 15,
        y + 13,
        {
          characterSpacing: 1.2,
        }
      );

    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND.plum)
      .text(
        paymentMethodLabel(
          snapshot.paymentMethod
        ),
        left + 15,
        y + 27
      );

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(BRAND.muted)
      .text(
        `Status: ${statusLabel(
          livePaymentStatus
        )}`,
        right - 160,
        y + 28,
        {
          width: 145,
          align: "right",
        }
      );

    y += 72;

    /* ----------------------------------------------------------
       FOOTER / TERMS
       ---------------------------------------------------------- */

    if (snapshot.business.footer) {
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(BRAND.plum)
        .text(
          snapshot.business.footer,
          left,
          y,
          {
            width: contentW,
            align: "center",
          }
        );

      y += 17;
    }

    if (snapshot.business.terms) {
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor(BRAND.muted)
        .text(
          snapshot.business.terms,
          left,
          y,
          {
            width: contentW,
            align: "center",
            lineGap: 2,
          }
        );

      y += 22;
    }

    /* ----------------------------------------------------------
       BRAND FOOTER
       ---------------------------------------------------------- */

    const footerY =
      Math.min(
        y + 10,
        pageH - 78
      );

    drawDivider(
      doc,
      left,
      right,
      footerY
    );

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(BRAND.pink)
      .text(
        "✦  SUTHRAYAA  ✦",
        left,
        footerY + 13,
        {
          width: contentW,
          align: "center",
        }
      );

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(BRAND.muted)
      .text(
        "Handmade pieces, made with love.",
        left,
        footerY + 28,
        {
          width: contentW,
          align: "center",
        }
      );

    doc
      .font("Helvetica")
      .fontSize(6.5)
      .fillColor(BRAND.mutedLight)
      .text(
        `Invoice ${invoiceNumber} · Order #${snapshot.orderNumber}`,
        left,
        footerY + 43,
        {
          width: contentW,
          align: "center",
        }
      );

    /* ----------------------------------------------------------
       FINISH
       ---------------------------------------------------------- */

    doc.end();
  });
}
