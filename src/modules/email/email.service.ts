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

function itemsRows(items: OrderEmailItem[]) {
  return items
    .map(
      (i) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee;">
          <div style="font-weight:600;color:#2a2420;">${i.name}</div>
          <div style="font-size:13px;color:#7a6f63;">
            ${i.selectedColorName ? `Color: ${i.selectedColorName}` : ""}
            ${i.customText ? ` &middot; "${i.customText}"` : ""}
            ${i.selectedColorName || i.customText ? " &middot; " : ""}Qty: ${i.quantity}
          </div>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;color:#2a2420;">
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
        <td style="padding:4px 0;color:#7a6f63;font-size:14px;">${label}</td>
        <td style="padding:4px 0;text-align:right;font-size:14px;color:#2a2420;">${amount < 0 ? "-" : ""}${formatPrice(Math.abs(amount))}</td>
      </tr>`
    )
    .join("");
}

function wrapEmail(title: string, bodyHtml: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf7f2;font-family:'Segoe UI',Arial,sans-serif;color:#2a2420;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f2;padding:32px 16px;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8e0d4;">
          <tr><td style="background:#1a365d;padding:24px 32px;">
            <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.02em;">Suthrayaa</span>
          </td></tr>
          <tr><td style="padding:32px;">
            <h1 style="font-size:20px;margin:0 0 16px;">${title}</h1>
            ${bodyHtml}
          </td></tr>
          <tr><td style="padding:20px 32px;background:#f6ddc9;text-align:center;font-size:12px;color:#7a6f63;">
            Handcrafted with love &middot; Suthrayaa
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function addressBlock(a: OrderEmailPayload["shippingAddress"]) {
  return `<p style="font-size:14px;color:#2a2420;line-height:1.6;margin:0;">
    ${a.firstName} ${a.lastName}<br/>
    ${a.addressLine1}${a.addressLine2 ? `, ${a.addressLine2}` : ""}<br/>
    ${a.city}, ${a.state} ${a.pincode}<br/>
    ${a.phone}
  </p>`;
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
    <p style="font-size:14px;color:#7a6f63;margin:0 0 20px;">
      Order <strong style="color:#2a2420;">${payload.orderNumber}</strong> is confirmed and being handcrafted with care.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${itemsRows(payload.items)}</table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
      ${summaryRows(payload)}
      <tr>
        <td style="padding:10px 0 0;font-weight:700;border-top:1px solid #e8e0d4;">Total</td>
        <td style="padding:10px 0 0;font-weight:700;text-align:right;border-top:1px solid #e8e0d4;">${formatPrice(payload.total)}</td>
      </tr>
    </table>
    <h2 style="font-size:14px;margin:24px 0 8px;">Shipping to</h2>
    ${addressBlock(payload.shippingAddress)}
    <p style="font-size:13px;color:#7a6f63;margin-top:24px;">
      Payment method: ${payload.paymentMethod === "cod" ? "Cash on Delivery" : "Paid online via Razorpay"}
    </p>
    `
  );

  await send(payload.customerEmail, `Order Confirmed — ${payload.orderNumber}`, html);
}

export async function sendAdminOrderNotification(payload: OrderEmailPayload) {
  if (!env.ADMIN_NOTIFICATION_EMAIL) return;

  const html = wrapEmail(
    `New order: ${payload.orderNumber}`,
    `
    <table width="100%" cellpadding="0" cellspacing="0">${itemsRows(payload.items)}</table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
      ${summaryRows(payload)}
      <tr>
        <td style="padding:10px 0 0;font-weight:700;border-top:1px solid #e8e0d4;">Total</td>
        <td style="padding:10px 0 0;font-weight:700;text-align:right;border-top:1px solid #e8e0d4;">${formatPrice(payload.total)}</td>
      </tr>
    </table>
    <h2 style="font-size:14px;margin:24px 0 8px;">Customer</h2>
    <p style="font-size:14px;margin:0 0 16px;">${payload.customerName} &middot; ${payload.customerEmail ?? "no email"}</p>
    <h2 style="font-size:14px;margin:0 0 8px;">Ship to</h2>
    ${addressBlock(payload.shippingAddress)}
    <p style="font-size:13px;color:#7a6f63;margin-top:24px;">
      Payment: ${payload.paymentMethod === "cod" ? "Cash on Delivery" : "Paid online via Razorpay"}
    </p>
    `
  );

  await send(env.ADMIN_NOTIFICATION_EMAIL, `🧶 New order ${payload.orderNumber} — ${formatPrice(payload.total)}`, html);
}

/** Renders the same branded items/summary/address blocks used above, for use as a trusted
 * ("raw", not HTML-escaped) template variable in the admin-editable email system below. */
export function renderOrderDetailsHtml(payload: OrderEmailPayload) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0">${itemsRows(payload.items)}</table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
      ${summaryRows(payload)}
      <tr>
        <td style="padding:10px 0 0;font-weight:700;border-top:1px solid #e8e0d4;">Total</td>
        <td style="padding:10px 0 0;font-weight:700;text-align:right;border-top:1px solid #e8e0d4;">${formatPrice(payload.total)}</td>
      </tr>
    </table>`;
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

/** {{variables}} are HTML-escaped (may contain customer-supplied text); rawVariables are
 * trusted, already-safe HTML built server-side (e.g. an items table) and inserted as-is. */
export function substituteTemplate(
  template: string,
  variables: Record<string, string>,
  rawVariables: Record<string, string> = {}
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in rawVariables) return rawVariables[key];
    if (key in variables) return escapeHtml(variables[key]);
    return match;
  });
}

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
    const html = wrapEmail(subject, bodyHtml);

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
    <p style="font-size:14px;color:#7a6f63;margin:0 0 20px;">
      We've received your message and will get back to you within 1-2 business days.
    </p>
    <h2 style="font-size:14px;margin:0 0 8px;">Your message</h2>
    <p style="font-size:14px;color:#2a2420;background:#faf7f2;border-radius:8px;padding:16px;margin:0;">
      <strong>${escapeHtml(safeSubject)}</strong><br/><br/>${messageHtml}
    </p>
    `
  );

  const adminHtml = wrapEmail(
    `New contact form message`,
    `
    <p style="font-size:14px;margin:0 0 16px;">
      <strong>${escapeHtml(payload.name)}</strong> &middot;
      <a href="mailto:${escapeHtml(payload.email)}" style="color:#1a365d;">${escapeHtml(payload.email)}</a>
    </p>
    <h2 style="font-size:14px;margin:0 0 8px;">${escapeHtml(safeSubject)}</h2>
    <p style="font-size:14px;color:#2a2420;background:#faf7f2;border-radius:8px;padding:16px;margin:0;">
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
