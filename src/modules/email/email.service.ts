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

// Brand tokens — mirrors the pink/lavender "handmade with love" theme introduced in
// templates/custom_order_confirmation.html. Email clients can't read CSS custom properties,
// so these are the same values inlined by hand, shared by every hand-built email in this file
// and used as the outer shell for every admin-editable template (see wrapEmail below).
const BRAND = {
  pageBg: "#FFF7F9",
  card: "#FFFFFF",
  cardAlt: "#FFFAFD",
  ink: "#3D2B35",
  muted: "#8F7A85",
  border: "#F1E5EB",
  primary: "#D96C8A",
  primaryDark: "#C55376",
  lavender: "#A77BCA",
  lavenderDark: "#936BB2",
  gold: "#C28A3E",
  sage: "#64957D",
  sageDark: "#579274",
  peach: "#FFF4F7",
  highlightBg: "#F7F1FC",
  highlightBorder: "#EADFF3",
  footerBg: "#3D2B35",
  footerHeading: "#F8E8EE",
  footerMuted: "#BDAAB2",
  footerLink: "#E3B9C7",
  footerFaint: "#82717A",
};

const LOGO_URL =
  "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Suthraya%20Logo%20-%20Trans-HgT4V8esTeOZ2PwWy5B7QcPjLLrahf.png";

type BadgeTone = "good" | "warning" | "critical" | "neutral";
const BADGE_TONE_COLORS: Record<BadgeTone, { bg: string; border: string; fg: string }> = {
  good: { bg: "#FFE4EC", border: "#F3B6C9", fg: "#C55376" },
  warning: { bg: "#FFF0D8", border: "#F0D09B", fg: "#8A5A1E" },
  critical: { bg: "#FCE8EA", border: "#F0C7CC", fg: "#B23A4A" },
  neutral: { bg: "#F7F1FC", border: "#EADFF3", fg: "#936BB2" },
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
        <td style="padding:16px 20px;background:#FFE8EF;border-top:1px solid #F4D2DC;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:${BRAND.primaryDark};vertical-align:middle;">Total</td>
        <td style="padding:16px 20px;background:#FFE8EF;border-top:1px solid #F4D2DC;text-align:right;vertical-align:middle;">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;color:#D05F80;">${formatPrice(payload.total)}</span>
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
        <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 18px;">
          <tr><td align="center" style="background:${c.bg};border:1px solid ${c.border};border-radius:100px;padding:8px 18px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${c.fg};">${options.badge!.label}</td></tr>
        </table>`;
      })()
    : "";

  const highlightHtml = options.highlight
    ? `
      <tr><td align="center" style="background:${BRAND.highlightBg};border-top:1px solid ${BRAND.highlightBorder};border-bottom:1px solid ${BRAND.highlightBorder};padding:19px 30px;">
        <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#9A88A5;">${options.highlight.label}</p>
        <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:18px;font-weight:700;color:${BRAND.lavenderDark};letter-spacing:1.5px;">${options.highlight.value}</p>
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
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BRAND.card};border-radius:20px;overflow:hidden;border:1px solid ${BRAND.border};">

          <tr><td height="6" style="background:${BRAND.primary};font-size:1px;line-height:1px;">&nbsp;</td></tr>

          <tr><td style="background:${BRAND.peach};padding:34px 32px 30px;text-align:center;">
            <p style="margin:0 0 12px;color:${BRAND.lavender};font-size:14px;letter-spacing:7px;">✦ ✧ ✦</p>
            <img src="${LOGO_URL}" alt="Suthrayaa" width="120" style="width:120px;max-width:120px;height:auto;margin:0 auto 20px;display:block;"/>
            ${badgeHtml}
            <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:${BRAND.ink};line-height:1.35;letter-spacing:-0.3px;">${title}</h1>
          </td></tr>

          ${highlightHtml}

          <tr><td style="background:${BRAND.card};padding:30px 32px;">
            ${bodyHtml}
          </td></tr>

          <tr><td align="center" style="background:#FFF0F4;border-top:1px solid #F4DFE7;border-bottom:1px solid #F4DFE7;padding:16px 25px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:${BRAND.primaryDark};">Made with love, just for you 💕</p>
          </td></tr>

          <tr><td align="center" style="background:${BRAND.footerBg};padding:28px 32px;">
            <img src="${LOGO_URL}" alt="Suthrayaa" width="56" style="width:56px;max-width:56px;height:auto;margin:0 auto 12px;display:block;filter:brightness(0) invert(1);"/>
            <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:${BRAND.footerHeading};">Suthrayaa</p>
            <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${BRAND.footerMuted};">Handcrafted with love, made just for you</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;"><a href="${env.FRONTEND_URL}" target="_blank" style="color:${BRAND.footerLink};text-decoration:none;">Shop</a></p>
            <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:${BRAND.footerFaint};">© ${new Date().getFullYear()} Suthrayaa. All rights reserved.</p>
          </td></tr>

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

// Matches only an innermost {{#if}}...{{/if}} block — one whose body contains no further
// {{#if }} of its own — via a negative lookahead that refuses to cross into a nested opener.
// Resolving repeatedly from the inside out (see substituteConditionals) lets nested
// conditionals (e.g. {{#if coupon_code}} inside {{#if has_discount}}) close at the right
// {{/if}} instead of a naive non-greedy regex matching the nearest {{/if}} regardless of depth.
const LEAF_IF = /\{\{#if (\w+)\}\}((?:(?!\{\{#if )[\s\S])*?)(?:\{\{else\}\}((?:(?!\{\{#if )[\s\S])*?))?\{\{\/if\}\}/;

function substituteConditionals(str: string, variables: Record<string, string>): string {
  let result = str;
  while (LEAF_IF.test(result)) {
    result = result.replace(LEAF_IF, (_match, key: string, whenTrue: string, whenFalse = "") => (isTruthy(variables, key) ? whenTrue : whenFalse));
  }
  return result;
}

function substituteVars(str: string, variables: Record<string, string>, rawVariables: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in rawVariables) return rawVariables[key];
    if (key in variables) return escapeHtml(variables[key]);
    return match;
  });
}

/** {{variables}} are HTML-escaped (may contain customer-supplied text); rawVariables are
 * trusted, already-safe HTML built server-side (e.g. an items table) and inserted as-is.
 * {{#if flag}}...{{else}}...{{/if}} blocks (nesting is fine, e.g. {{#if coupon_code}} inside
 * {{#if has_discount}}) let a template branch on a boolean-ish variable — e.g. showing a
 * tracking number only once one exists.
 * {{#each listKey}}...{{/each}} repeats its block once per row in `listVariables[listKey]`,
 * with {{#if}}/{{var}} inside the block resolved against that row's own fields (e.g. looping
 * order line items with a per-item product image, quantity, and price). */
export function substituteTemplate(
  template: string,
  variables: Record<string, string>,
  rawVariables: Record<string, string> = {},
  listVariables: Record<string, Array<Record<string, string>>> = {}
): string {
  const withEach = template.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_match, key: string, block: string) => {
    const rows = listVariables[key] ?? [];
    return rows.map((row) => substituteVars(substituteConditionals(block, row), row, {})).join("");
  });
  const withConditionals = substituteConditionals(withEach, variables);
  return substituteVars(withConditionals, variables, rawVariables);
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

/** Renders a template's already-substituted subject/body into the final email HTML — wrapping
 * bare body fragments in the shared branded shell, or passing a full standalone document (like
 * custom_order_confirmation.html) through untouched so its own chrome isn't nested inside a
 * second one. Shared by the real send path and the admin's "send test email" action so a test
 * send actually looks like the email a customer would receive. */
export function renderFinalEmailHtml(type: string, subject: string, bodyHtml: string, orderNumber?: string): string {
  if (/^\s*<!doctype html/i.test(bodyHtml)) return bodyHtml;
  return wrapEmail(subject, bodyHtml, {
    badge: EMAIL_TYPE_BADGE[type],
    highlight: orderNumber ? { label: "Order Number", value: orderNumber } : undefined,
  });
}

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
  listVariables?: Record<string, Array<Record<string, string>>>;
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
    const bodyHtml = substituteTemplate(template.body_html, input.variables, input.rawVariables, input.listVariables);
    const html = renderFinalEmailHtml(input.type, subject, bodyHtml, input.variables.order_number);

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
