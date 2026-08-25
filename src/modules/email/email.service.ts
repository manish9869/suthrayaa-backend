import nodemailer from "nodemailer";
import { env, isEmailConfigured } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { formatPrice } from "../../lib/format.js";
import { supabaseAdmin } from "../../config/supabase.js";

const transporter = isEmailConfigured
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    })
  : null;

interface OrderEmailItem {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  selectedColorName?: string | null;
  customText?: string | null;
}

interface OrderEmailPayload {
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  paymentMethod: string;
  subtotal: number;
  discountAmount: number;
  shippingCost: number;
  giftWrapCost: number;
  total: number;
  shippingAddress: {
    firstName: string;
    lastName: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    pincode: string;
    phone: string;
  };
  items: OrderEmailItem[];
}

// Brand tokens — mirrors app/globals.css's warm terracotta/cream palette. Email clients
// can't read CSS custom properties, so these are the same values inlined by hand.
const BRAND = {
  pageBg: "#f1e9d8",
  card: "#fffdf9",
  cardAlt: "#fbf6ee",
  ink: "#3a2420",
  muted: "#8a7a63",
  border: "#e8dcc4",
  primary: "#c1502e",
  primaryDark: "#a8431f",
  gold: "#d8a13b",
  sage: "#7c9473",
  mint: "#a9c9a0",
  mintInk: "#22391f",
  destructive: "#d64545",
  peach: "#f6ddc9",
};

const LOGO_URL =
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Suthraya%20Logo%20-%20Trans-HgT4V8esTeOZ2PwWy5B7QcPjLLrahf.png";

type BadgeTone = "good" | "warning" | "critical" | "neutral";
const BADGE_TONE_COLORS: Record<BadgeTone, { bg: string; border: string; fg: string }> = {
  good: { bg: "rgba(169,201,160,0.28)", border: "rgba(124,148,115,0.5)", fg: "#22391f" },
  warning: { bg: "rgba(216,161,59,0.2)", border: "rgba(216,161,59,0.5)", fg: "#5c3a1e" },
  critical: { bg: "rgba(214,69,69,0.14)", border: "rgba(214,69,69,0.45)", fg: "#a8341f" },
  neutral: { bg: "rgba(138,122,99,0.14)", border: "rgba(138,122,99,0.35)", fg: "#5c4f3d" },
};

function itemsRows(items: OrderEmailItem[]) {
  return items
    .map(
      (i) => `
      <tr>
        <td style="padding:14px 20px;border-bottom:1px solid ${BRAND.border};">
          <div style="font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:14px;color:${BRAND.ink};">${i.name}</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.muted};margin-top:2px;">
            ${i.selectedColorName ? `Color: ${i.selectedColorName}` : ""}
            ${i.customText ? ` &middot; &quot;${i.customText}&quot;` : ""}
            ${i.selectedColorName || i.customText ? " &middot; " : ""}Qty: ${i.quantity}
          </div>
        </td>
        <td style="padding:14px 20px;border-bottom:1px solid ${BRAND.border};text-align:right;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:${BRAND.ink};vertical-align:top;">
          ${formatPrice(i.lineTotal)}
        </td>
      </tr>`
    )
    .join("");
}

function summaryRows(payload: OrderEmailPayload) {
  const rows: [string, number][] = [["Subtotal", payload.subtotal]];
  if (payload.discountAmount > 0) rows.push(["Discount", -payload.discountAmount]);
  rows.push(["Shipping", payload.shippingCost]);
  if (payload.giftWrapCost > 0) rows.push(["Gift Wrap", payload.giftWrapCost]);
  return rows
    .map(
      ([label, amount]) => `
      <tr>
        <td style="padding:8px 20px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.muted};font-size:13px;border-bottom:1px solid ${BRAND.border};">${label}</td>
        <td style="padding:8px 20px;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${BRAND.ink};border-bottom:1px solid ${BRAND.border};">${amount < 0 ? "&minus;" : ""}${formatPrice(Math.abs(amount))}</td>
      </tr>`
    )
    .join("");
}

/** The full items + cost breakdown + total, as one bordered card — used by the order
 * confirmation email and as the {{items_table}} raw variable in admin-editable templates. */
export function renderOrderDetailsHtml(payload: OrderEmailPayload) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cardAlt};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
      ${itemsRows(payload.items)}
      ${summaryRows(payload)}
      <tr>
        <td style="padding:16px 20px;background:rgba(193,80,46,0.07);border-top:1px solid rgba(193,80,46,0.18);font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${BRAND.muted};vertical-align:middle;">Total</td>
        <td style="padding:16px 20px;background:rgba(193,80,46,0.07);border-top:1px solid rgba(193,80,46,0.18);text-align:right;vertical-align:middle;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:${BRAND.primary};">${formatPrice(payload.total)}</span>
        </td>
      </tr>
    </table>`;
}

function addressBlock(a: OrderEmailPayload["shippingAddress"]) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cardAlt};border:1px solid ${BRAND.border};border-radius:12px;">
    <tr><td style="padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.ink};line-height:1.7;">
      <strong>${a.firstName} ${a.lastName}</strong><br/>
      ${a.addressLine1}${a.addressLine2 ? `, ${a.addressLine2}` : ""}<br/>
      ${a.city}, ${a.state} ${a.pincode}<br/>
      <span style="color:${BRAND.muted};">${a.phone}</span>
    </td></tr>
  </table>`;
}

/** Wraps templated content in the shared branded shell: gradient accent bars, logo header
 * with an optional status pill, an optional highlight strip (e.g. order number), the body,
 * a trust strip, and a footer. `badge`/`highlight` are opt-in so generic mail (contact-form
 * replies) can skip them while order/payment mail gets the full treatment. */
export function wrapEmail(
  title: string,
  bodyHtml: string,
  options: { badge?: { label: string; tone?: BadgeTone }; highlight?: { label: string; value: string } } = {}
) {
  const badgeHtml = options.badge
    ? (() => {
        const c = BADGE_TONE_COLORS[options.badge!.tone ?? "neutral"];
        return `
        <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 16px;">
          <tr><td align="center" style="background:${c.bg};border:1px solid ${c.border};border-radius:100px;padding:6px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${c.fg};">${options.badge!.label}</td></tr>
        </table>`;
      })()
    : "";

  const highlightHtml = options.highlight
    ? `
      <tr><td style="background:rgba(193,80,46,0.06);border-top:1px solid rgba(193,80,46,0.14);border-bottom:1px solid rgba(193,80,46,0.14);padding:16px 32px;text-align:center;">
        <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${BRAND.muted};">${options.highlight.label}</p>
        <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:18px;font-weight:700;color:${BRAND.primary};letter-spacing:1.5px;">${options.highlight.value}</p>
      </td></tr>`
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
</head>
  <body style="margin:0;padding:0;background:${BRAND.pageBg};font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.pageBg};padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

          <tr><td height="4" style="background:linear-gradient(90deg,${BRAND.primary} 0%,${BRAND.gold} 50%,${BRAND.primary} 100%);border-radius:6px 6px 0 0;font-size:1px;line-height:1px;">&nbsp;</td></tr>

          <tr><td style="background:linear-gradient(160deg,${BRAND.card} 0%,${BRAND.peach} 100%);border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:36px 32px 30px;text-align:center;">
            <img src="${LOGO_URL}" alt="Suthrayaa" width="110" style="width:110px;height:auto;margin:0 auto 22px;display:block;"/>
            ${badgeHtml}
            <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;color:${BRAND.ink};line-height:1.35;">${title}</h1>
          </td></tr>

          ${highlightHtml}

          <tr><td style="background:${BRAND.card};border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};padding:30px 32px;">
            ${bodyHtml}
          </td></tr>

          <tr><td style="background:rgba(124,148,115,0.08);border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};border-top:1px solid rgba(124,148,115,0.18);padding:12px 32px;text-align:center;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${BRAND.sage};">&#10003;&nbsp;&nbsp;Handmade in small batches &middot; Secure checkout &middot; Suthrayaa</p>
          </td></tr>

          <tr><td style="background:${BRAND.cardAlt};border:1px solid ${BRAND.border};border-top:none;border-radius:0 0 12px 12px;padding:22px 32px;text-align:center;">
            <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:${BRAND.ink};">Suthrayaa</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${BRAND.muted};">Handcrafted with love, made just for you</p>
          </td></tr>

          <tr><td height="4" style="background:linear-gradient(90deg,transparent 0%,${BRAND.gold} 50%,transparent 100%);font-size:1px;line-height:1px;">&nbsp;</td></tr>

        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function send(to: string, subject: string, html: string) {
  if (!transporter) {
    logger.warn({ to, subject }, "[dummy] Email not sent — GMAIL_USER/GMAIL_APP_PASSWORD not configured yet");
    return;
  }
  try {
    await transporter.sendMail({ from: `Suthrayaa <${env.GMAIL_USER}>`, to, subject, html });
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email");
  }
}

export async function sendOrderConfirmationEmail(payload: OrderEmailPayload) {
  if (!payload.customerEmail) return;

  const html = wrapEmail(
    `Thanks for your order, ${payload.customerName.split(" ")[0]}!`,
    `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.muted};margin:0 0 20px;line-height:1.6;">
      Your order is confirmed and being handcrafted with care.
    </p>
    ${renderOrderDetailsHtml(payload)}
    <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};margin:24px 0 10px;">Shipping to</h2>
    ${addressBlock(payload.shippingAddress)}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.muted};margin-top:20px;">
      Payment method: ${payload.paymentMethod === "cod" ? "Cash on Delivery" : "Paid online via Razorpay"}
    </p>
    `,
    { badge: { label: "Order Confirmed", tone: "good" }, highlight: { label: "Order Number", value: payload.orderNumber } }
  );

  await send(payload.customerEmail, `Order Confirmed — ${payload.orderNumber}`, html);
}

export async function sendAdminOrderNotification(payload: OrderEmailPayload) {
  if (!env.ADMIN_NOTIFICATION_EMAIL) return;

  const html = wrapEmail(
    `New order received`,
    `
    ${renderOrderDetailsHtml(payload)}
    <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};margin:24px 0 10px;">Customer</h2>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:0 0 16px;color:${BRAND.ink};">${payload.customerName} &middot; ${payload.customerEmail ?? "no email"}</p>
    <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};margin:0 0 10px;">Ship to</h2>
    ${addressBlock(payload.shippingAddress)}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.muted};margin-top:20px;">
      Payment: ${payload.paymentMethod === "cod" ? "Cash on Delivery" : "Paid online via Razorpay"}
    </p>
    `,
    { badge: { label: "New Order", tone: "neutral" }, highlight: { label: "Order Number", value: payload.orderNumber } }
  );

  await send(env.ADMIN_NOTIFICATION_EMAIL, `🧶 New order ${payload.orderNumber} — ${formatPrice(payload.total)}`, html);
}

export function renderAddressHtml(a: OrderEmailPayload["shippingAddress"]) {
  return addressBlock(a);
}

// ---- Admin-editable templated emails (order lifecycle, payment, custom orders, invoices) ----

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A value counts as "truthy" for {{#if}} purposes if it's a non-empty, non-"false"/"0" string. */
function isTruthy(variables: Record<string, string>, key: string): boolean {
  const v = variables[key];
  return Boolean(v) && v !== "false" && v !== "0";
}

/** {{variables}} are HTML-escaped (may contain customer-supplied text); rawVariables are
 * trusted, already-safe HTML built server-side (e.g. an items table) and inserted as-is.
 * {{#if flag}}...{{else}}...{{/if}} blocks (no nesting) let a single template branch on a
 * boolean-ish variable — e.g. showing a tracking number only once one exists. */
export function substituteTemplate(
  template: string,
  variables: Record<string, string>,
  rawVariables: Record<string, string> = {}
): string {
  const withConditionals = template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (_match, key: string, whenTrue: string, whenFalse = "") => (isTruthy(variables, key) ? whenTrue : whenFalse)
  );
  return withConditionals.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in rawVariables) return rawVariables[key];
    if (key in variables) return escapeHtml(variables[key]);
    return match;
  });
}

// Auto-derives a status pill for each admin-editable template type — so every order/payment
// email gets the same polished badge treatment without every call site having to specify one.
const EMAIL_TYPE_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  order_placed: { label: "Order Received", tone: "good" },
  order_confirmed: { label: "Order Confirmed", tone: "good" },
  order_making: { label: "In Production", tone: "neutral" },
  order_ready: { label: "Ready to Ship", tone: "neutral" },
  order_shipped: { label: "Shipped", tone: "good" },
  order_tracking_updated: { label: "Tracking Updated", tone: "good" },
  order_delivered: { label: "Delivered", tone: "good" },
  order_cancelled: { label: "Order Cancelled", tone: "critical" },
  payment_successful: { label: "Payment Received", tone: "good" },
  payment_failed: { label: "Payment Failed", tone: "critical" },
  refund_processed: { label: "Refund Processed", tone: "warning" },
  custom_order_confirmation: { label: "Custom Order Confirmed", tone: "good" },
  invoice_email: { label: "Invoice Attached", tone: "neutral" },
  customer_welcome: { label: "Welcome", tone: "good" },
  admin_new_order: { label: "New Order", tone: "neutral" },
  admin_new_enquiry: { label: "New Enquiry", tone: "neutral" },
  admin_payment_failed: { label: "Payment Failed", tone: "critical" },
};

/** Order-lifecycle types selectable in the admin's manual "Send Email" action on an order —
 * every type that takes the standard order variable set (customer_name, order_number,
 * order_total, tracking_number, store_name). Excludes invoice_email (needs a PDF attachment,
 * has its own dedicated action) and the admin-facing/customer-welcome types (different variables,
 * different trigger point). */
export const ORDER_EMAIL_TYPES = [
  "order_placed",
  "order_confirmed",
  "order_making",
  "order_ready",
  "order_shipped",
  "order_tracking_updated",
  "order_delivered",
  "order_cancelled",
  "payment_successful",
  "payment_failed",
  "refund_processed",
  "custom_order_confirmation",
] as const;

export interface TemplatedEmailInput {
  type: string;
  to: string;
  variables: Record<string, string>;
  rawVariables?: Record<string, string>;
  relatedOrderId?: string;
  attachments?: { filename: string; content: Buffer }[];
}

/** Looks up the admin-editable template by type, renders it, sends it, and logs the
 * attempt. Never throws — a broken/misconfigured email must never block an order. */
export async function sendTemplatedEmail(input: TemplatedEmailInput) {
  try {
    const { data: template } = await supabaseAdmin
      .from("email_templates")
      .select("*")
      .eq("type", input.type)
      .maybeSingle();
    if (!template || !template.enabled) return;

    const subject = substituteTemplate(template.subject, input.variables, input.rawVariables);
    const bodyHtml = substituteTemplate(template.body_html, input.variables, input.rawVariables);
    const orderNumber = input.variables.order_number;
    const html = wrapEmail(subject, bodyHtml, {
      badge: EMAIL_TYPE_BADGE[input.type],
      highlight: orderNumber ? { label: "Order Number", value: orderNumber } : undefined,
    });

    if (!transporter) {
      logger.warn({ to: input.to, type: input.type }, "[dummy] Templated email not sent — email not configured yet");
      return;
    }

    let status: "sent" | "failed" = "sent";
    let errorMessage: string | null = null;
    try {
      await transporter.sendMail({
        from: `Suthrayaa <${env.GMAIL_USER}>`,
        to: input.to,
        subject,
        html,
        attachments: input.attachments,
      });
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err, to: input.to, type: input.type }, "Templated email failed to send");
    }

    await supabaseAdmin.from("email_logs").insert({
      type: input.type,
      recipient: input.to,
      order_id: input.relatedOrderId ?? null,
      subject,
      body_html: html,
      status,
      error_message: errorMessage,
    });
  } catch (err) {
    logger.error({ err, type: input.type }, "sendTemplatedEmail failed unexpectedly");
  }
}

/** Re-sends a previously logged email exactly as it was rendered — used for the admin's "retry failed" action. */
export async function resendLoggedEmail(to: string, subject: string, html: string) {
  if (!transporter) throw new Error("Email is not configured");
  await transporter.sendMail({ from: `Suthrayaa <${env.GMAIL_USER}>`, to, subject, html });
}

// ---- Contact form ----

interface ContactMessagePayload {
  name: string;
  email: string;
  subject?: string;
  message: string;
}

/** Sends the "we got your message" reply to the customer and the notification to the store's
 * admin inbox. Fire-and-forget from the route's perspective — a broken/misconfigured mailbox
 * must never fail the request, so failures are logged, not thrown. */
export async function sendContactFormEmails(payload: ContactMessagePayload) {
  const safeSubject = payload.subject?.trim() || "General enquiry";
  const messageHtml = escapeHtml(payload.message).replace(/\n/g, "<br/>");

  const customerHtml = wrapEmail(
    `Thanks for reaching out, ${payload.name.split(" ")[0]}!`,
    `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.muted};margin:0 0 20px;line-height:1.6;">
      We've received your message and will get back to you within 1-2 business days.
    </p>
    <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};margin:0 0 10px;">Your message</h2>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.ink};background:${BRAND.cardAlt};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 20px;margin:0;line-height:1.6;">
      <strong>${escapeHtml(safeSubject)}</strong><br/><br/>${messageHtml}
    </p>
    `,
    { badge: { label: "Message Received", tone: "good" } }
  );

  const adminHtml = wrapEmail(
    `New contact form message`,
    `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:0 0 16px;color:${BRAND.ink};">
      <strong>${escapeHtml(payload.name)}</strong> &middot;
      <a href="mailto:${escapeHtml(payload.email)}" style="color:${BRAND.primary};">${escapeHtml(payload.email)}</a>
    </p>
    <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};margin:0 0 10px;">${escapeHtml(safeSubject)}</h2>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.ink};background:${BRAND.cardAlt};border:1px solid ${BRAND.border};border-radius:12px;padding:16px 20px;margin:0;line-height:1.6;">
      ${messageHtml}
    </p>
    `
  );

  await Promise.all([
    send(payload.email, "We've got your message — Suthrayaa", customerHtml),
    env.ADMIN_NOTIFICATION_EMAIL
      ? send(env.ADMIN_NOTIFICATION_EMAIL, `New enquiry: ${safeSubject}`, adminHtml)
      : Promise.resolve(),
  ]);
}
