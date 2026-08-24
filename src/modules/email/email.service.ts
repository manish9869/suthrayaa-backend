import nodemailer from "nodemailer";
import { env, isEmailConfigured } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { formatPrice } from "../../lib/format.js";

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
