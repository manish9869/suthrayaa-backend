import nodemailer from "nodemailer";
import { env, isEmailConfigured } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { formatPrice } from "../../lib/format.js";
import { supabaseAdmin } from "../../config/supabase.js";
import { getSettingSync } from "../settings/settings.service.js";
import { T, SANS, SERIF, type Tone, eyebrow, h1, strip, shell } from "./theme.js";

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

// The storefront / invoice design system (ink header, lilac canvas, violet + peach accents) —
// shared with the generated templates in ./templates via ./theme.ts.
type BadgeTone = "good" | "warning" | "critical" | "neutral";
const BADGE_TONE: Record<BadgeTone, Tone> = { good: "green", warning: "gold", critical: "red", neutral: "violet" };

function itemsRows(items: OrderEmailItem[]) {
  return items
    .map((i) => {
      const meta = [i.selectedColorName ? escapeHtml(i.selectedColorName) : null, i.customText ? `&ldquo;${escapeHtml(i.customText)}&rdquo;` : null, `Qty ${i.quantity}`]
        .filter(Boolean)
        .join(" &middot; ");
      return `
      <tr>
        <td style="padding:14px 18px;border-bottom:1px solid ${T.border};">
          <p style="margin:0 0 3px;font-family:${SANS};font-size:14.5px;font-weight:700;color:${T.ink};">${escapeHtml(i.name)}</p>
          <p style="margin:0;font-family:${SANS};font-size:12.5px;color:${T.muted};">${meta}</p>
        </td>
        <td align="right" valign="top" style="padding:14px 18px;border-bottom:1px solid ${T.border};white-space:nowrap;font-family:${SANS};font-size:14.5px;font-weight:700;color:${T.ink};">${formatPrice(i.lineTotal)}</td>
      </tr>`;
    })
    .join("");
}

function summaryRows(payload: OrderEmailPayload) {
  const rows: [string, number][] = [["Subtotal", payload.subtotal]];
  if (payload.discountAmount > 0) rows.push(["Discount", -payload.discountAmount]);
  rows.push(["Shipping", payload.shippingCost]);
  if (payload.giftWrapCost > 0) rows.push(["Gift wrap", payload.giftWrapCost]);
  return rows
    .map(
      ([label, amount], i) => `
      <tr>
        <td style="padding:${i ? 5 : 14}px 18px 5px;font-family:${SANS};font-size:14px;color:${T.muted};">${label}</td>
        <td align="right" style="padding:${i ? 5 : 14}px 18px 5px;font-family:${SANS};font-size:14px;font-weight:600;color:${amount < 0 ? T.green : T.ink};">${amount < 0 ? "&minus;" : ""}${label === "Shipping" && amount === 0 ? "Free" : formatPrice(Math.abs(amount))}</td>
      </tr>`
    )
    .join("");
}

/** The full items + cost breakdown + total, as one bordered card — used as the
 * {{items_table}} raw variable in order emails. */
export function renderOrderDetailsHtml(payload: OrderEmailPayload) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${T.border};border-radius:16px;border-collapse:separate;overflow:hidden;">
      ${itemsRows(payload.items)}
      ${summaryRows(payload)}
      <tr><td colspan="2" style="padding:10px 12px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.ink};border-radius:12px;"><tr>
          <td style="padding:16px 18px;font-family:${SANS};font-size:11.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${T.lilacText};">Total</td>
          <td align="right" style="padding:16px 18px;font-family:${SERIF};font-size:24px;font-weight:500;color:#FFFFFF;">${formatPrice(payload.total)}</td>
        </tr></table>
      </td></tr>
    </table>`;
}

function addressBlock(a: OrderEmailPayload["shippingAddress"]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.lilac};border:1px solid ${T.border};border-radius:16px;">
    <tr><td style="padding:16px 18px;font-family:${SANS};font-size:14px;line-height:1.65;color:${T.text};">
      <strong style="color:${T.ink};">${escapeHtml(`${a.firstName} ${a.lastName}`)}</strong><br/>
      ${escapeHtml(a.addressLine1)}${a.addressLine2 ? `, ${escapeHtml(a.addressLine2)}` : ""}<br/>
      ${escapeHtml(a.city)}, ${escapeHtml(a.state)} ${escapeHtml(a.pincode)}<br/>
      <span style="color:${T.muted};">${escapeHtml(a.phone)}</span>
    </td></tr>
  </table>`;
}

/** Wraps a bare body fragment (an admin-edited template, or mail built in code) in the
 * shared branded shell, with an optional status chip and order-number strip. */
export function wrapEmail(
  title: string,
  bodyHtml: string,
  options: { badge?: { label: string; tone?: BadgeTone }; highlight?: { label: string; value: string }; admin?: boolean } = {}
) {
  const links = storeLinkVariables();
  const head = [
    options.badge ? eyebrow(options.badge.label, BADGE_TONE[options.badge.tone ?? "neutral"]) : "",
    h1(escapeHtml(title)),
    options.highlight ? strip([{ label: options.highlight.label, value: escapeHtml(options.highlight.value), mono: true }]) : "",
  ].join("\n");
  return shell({
    title,
    preheader: title,
    admin: options.admin,
    body: `${head}\n<div style="margin-top:22px;font-family:${SANS};font-size:15px;line-height:1.65;color:${T.muted};">${bodyHtml}</div>`,
    links: {
      store: links.store_url,
      support: links.support_url,
      contact: links.contact_url,
      year: links.current_year,
      instagram: links.instagram_url || undefined,
      facebook: links.facebook_url || undefined,
    },
  });
}

export async function sendAdminOrderNotification(payload: OrderEmailPayload) {
  if (!env.ADMIN_NOTIFICATION_EMAIL) return;

  const itemCount = payload.items.reduce((s, i) => s + i.quantity, 0);

  await sendTemplatedEmail({
    type: "admin_new_order",
    to: env.ADMIN_NOTIFICATION_EMAIL,
    variables: {
      order_number: payload.orderNumber,
      order_total: formatPrice(payload.total),
      item_count: String(itemCount),
      customer_name: payload.customerName,
      customer_email: payload.customerEmail ?? "no email on file",
      ...storeLinkVariables(),
    },
    rawVariables: {
      items_table: renderOrderDetailsHtml(payload),
      address_block: addressBlock(payload.shippingAddress),
    },
  });
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

/** Removes any {{placeholder}} (or stray {{#if}}/{{/if}} tag) left after substitution. */
export function stripUnresolved(str: string): string {
  return str.replace(/\{\{[#/]?[\w ]+\}\}/g, "");
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
    highlight: orderNumber ? { label: "Order", value: orderNumber } : undefined,
    admin: type.startsWith("admin_"),
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

    // Any {{placeholder}} the sender didn't supply is dropped rather than shown to the customer
    const subject = stripUnresolved(substituteTemplate(template.subject, input.variables, input.rawVariables));
    const bodyHtml = stripUnresolved(substituteTemplate(template.body_html, input.variables, input.rawVariables, input.listVariables));
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

/** The store/support/social links every richer admin-editable template can reference —
 * shared by any hand-built send (like the contact form) that isn't going through the
 * per-order variable builder in admin.orders.routes.ts. */
export function storeLinkVariables(): Record<string, string> {
  const instagramEnabled = getSettingSync<boolean>("social.instagram_enabled");
  const facebookEnabled = getSettingSync<boolean>("social.facebook_enabled");
  return {
    store_url: env.FRONTEND_URL,
    support_url: `${env.FRONTEND_URL}/faqs`,
    contact_url: `${env.FRONTEND_URL}/contact`,
    instagram_url: instagramEnabled ? getSettingSync<string>("social.instagram_url") : "",
    facebook_url: facebookEnabled ? getSettingSync<string>("social.facebook_url") : "",
    current_year: String(new Date().getFullYear()),
  };
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
  const enquiryMessageHtml = `<strong>${escapeHtml(safeSubject)}</strong><br/><br/>${messageHtml}`;

  await Promise.all([
    sendTemplatedEmail({
      type: "contact_enquiry_ack",
      to: payload.email,
      variables: {
        customer_name: payload.name,
        ...storeLinkVariables(),
      },
      rawVariables: {
        enquiry_message: enquiryMessageHtml,
      },
    }),
    env.ADMIN_NOTIFICATION_EMAIL
      ? sendTemplatedEmail({
          type: "admin_new_enquiry",
          to: env.ADMIN_NOTIFICATION_EMAIL,
          variables: {
            customer_name: payload.name,
            customer_email: payload.email,
            ...storeLinkVariables(),
          },
          rawVariables: {
            enquiry_message: enquiryMessageHtml,
          },
        })
      : Promise.resolve(),
  ]);
}
