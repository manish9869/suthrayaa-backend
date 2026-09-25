/**
 * Generates every transactional email template in src/modules/email/templates/ from one set
 * of brand components, so all 18 emails share the storefront / invoice design: an ink header
 * with the white logo and a stitched peach divider, a lilac canvas, Fraunces-style serif
 * headlines, violet actions and a matching ink footer.
 *
 *   pnpm tsx scripts/build-email-templates.ts      # rewrite the .html files
 *   pnpm tsx scripts/sync-email-templates.ts       # push them to the email_templates table
 *
 * Each template only uses the {{variables}} its sender provides (see email.service.ts,
 * checkout.service.ts, admin.orders.routes.ts); anything optional is wrapped in {{#if}}.
 * Everything is table-based with inline styles so it renders in Gmail, Outlook and Apple Mail.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "modules", "email", "templates");

import {
  T, SANS,
  p, eyebrow, h1, sectionLabel, button, buttons, strip, progress, panel, kv, steps, note, helpLine,
  itemsEach, totals, shipAndPay, shell,
} from "../src/modules/email/theme.js";

/* ============================================================ templates */

type Tpl = { subject: string; html: string };
const tpl: Record<string, Tpl> = {};

const orderStrip = (extra: { label: string; value: string }[] = []) => strip([{ label: "Order", value: "{{order_number}}", mono: true }, ...extra]);
const viewOrder = (label = "View your order") => `{{#if order_url}}${buttons(button(label, "{{order_url}}"))}{{/if}}`;

tpl.order_placed = {
  subject: "We've received your order {{order_number}} 🧶",
  html: shell({
    title: "Order received",
    preheader: "Thank you! Your Suthrayaa order {{order_number}} is safely with us.",
    body: `${eyebrow("Order received", "violet")}
${h1("Thank you, {{customer_name}}!")}
${p("Your order is safely with us. Every Suthrayaa piece is crocheted by hand in small batches, so we'll let you know at each step as it comes to life.")}
${orderStrip([{ label: "Items", value: "{{item_count}}" }, { label: "Total", value: "{{order_total}}" }])}
${progress(0)}
{{#if invoice_number}}${note(`Your invoice <strong>{{invoice_number}}</strong> is attached to this email as a PDF.`, "violet")}{{/if}}
${sectionLabel("Your order")}
{{items_table}}
${sectionLabel("Shipping to")}
{{address_block}}
${viewOrder()}
${sectionLabel("What happens next")}
${steps([
  { title: "We confirm your order", body: "We check the details and reserve yarn for your pieces." },
  { title: "Made by hand", body: "Your order goes onto our hooks — made slowly, with care." },
  { title: "Packed & shipped", body: "You'll get a tracking number as soon as it's on its way." },
])}
${helpLine()}`,
  }),
};

const confirmedBody = (custom: boolean) => `${eyebrow(custom ? "Custom order confirmed" : "Order confirmed", "green")}
${h1(custom ? "Your custom piece is confirmed, {{customer_name}}" : "Your order is confirmed, {{customer_name}}")}
${p(
  custom
    ? "Thank you for trusting us with something made just for you. We've noted every detail of your customisation and will start crocheting soon — custom pieces take a little longer, and we'll keep you posted at every step."
    : "Good news — your order is confirmed and heading to our makers. We'll crochet each piece with care and send you an update when it's on its way."
)}
${orderStrip([{ label: "Items", value: "{{item_count}}" }, { label: "Payment", value: "{{payment_status}}" }])}
${progress(1)}
${sectionLabel(custom ? "Made to your order" : "Your order", "{{item_count}} item(s)")}
${itemsEach}
${totals(custom ? "total" : "order_total")}
${sectionLabel("Delivery & payment")}
${shipAndPay}
${viewOrder("Track your order")}
${helpLine()}`;

tpl.order_confirmed = {
  subject: "Your Suthrayaa order {{order_number}} is confirmed ✓",
  html: shell({ title: "Order confirmed", preheader: "Your order {{order_number}} is confirmed and heading to our makers.", body: confirmedBody(false) }),
};
tpl.custom_order_confirmation = {
  subject: "Your custom Suthrayaa order {{order_number}} is confirmed ✓",
  html: shell({ title: "Custom order confirmed", preheader: "We've noted every detail of your custom order {{order_number}}.", body: confirmedBody(true) }),
};

tpl.order_making = {
  subject: "Your order {{order_number}} is on the hook 🧶",
  html: shell({
    title: "Being handmade",
    preheader: "Your Suthrayaa pieces are being crocheted by hand right now.",
    body: `${eyebrow("Being handmade", "peach")}
${h1("Your pieces are on the hook, {{customer_name}}")}
${p("Your order has moved to our making table. Each stitch is worked by hand, so it takes a little time — and that's exactly what makes it yours.")}
${orderStrip([{ label: "Stage", value: "Handmaking" }])}
${progress(2)}
${panel(p("We check every piece for shape, finish and colour before it's packed. If anything needs your input, we'll reach out before we continue.", { size: 14, mb: 0 }), { tone: "peach", icon: "&#10047;", title: "Made slowly, with care" })}
${viewOrder("Follow your order")}
${helpLine()}`,
  }),
};

tpl.order_ready = {
  subject: "Your order {{order_number}} is ready to ship ✨",
  html: shell({
    title: "Ready to ship",
    preheader: "Your handmade order {{order_number}} is finished and being packed.",
    body: `${eyebrow("Ready to ship", "violet")}
${h1("Almost there, {{customer_name}}!")}
${p("Your pieces are finished, checked and being packed with care. We'll send your tracking number the moment they're handed to our courier.")}
${orderStrip([{ label: "Stage", value: "Packing" }, { label: "Total", value: "{{order_total}}" }])}
${progress(3)}
${viewOrder()}
${helpLine()}`,
  }),
};

const trackingPanel = `{{#if tracking_number}}${panel(
  `<p style="margin:0 0 4px;font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${T.faint};">Tracking number</p>
   <p style="margin:0;font-family:${SANS};font-size:20px;font-weight:800;letter-spacing:1px;color:${T.ink};">{{tracking_number}}</p>`,
  { bg: T.lilac }
)}{{/if}}`;

tpl.order_shipped = {
  subject: "Your order {{order_number}} is on its way 📦",
  html: shell({
    title: "Shipped",
    preheader: "Your Suthrayaa order {{order_number}} has shipped.",
    body: `${eyebrow("Shipped", "green")}
${h1("It's on its way, {{customer_name}}!")}
${p("Your handmade order has left our studio and is travelling to you. Keep an eye out for your courier over the next few days.")}
${orderStrip([{ label: "Stage", value: "In transit" }])}
${progress(3)}
${trackingPanel}
{{#if tracking_url}}${buttons(button("Track your package", "{{tracking_url}}"))}{{else}}${viewOrder()}{{/if}}
${sectionLabel("When it arrives")}
${steps([
  { title: "Open with care", body: "Your pieces are wrapped to keep their shape — unfold gently." },
  { title: "Keep them lovely", body: "Hand wash in cool water with mild soap and dry flat, away from direct sun." },
])}
${helpLine()}`,
  }),
};

tpl.order_tracking_updated = {
  subject: "Tracking added for your order {{order_number}}",
  html: shell({
    title: "Tracking added",
    preheader: "Follow your Suthrayaa order {{order_number}} with the tracking number inside.",
    body: `${eyebrow("Tracking added", "violet")}
${h1("You can now track your order")}
${p("Hi {{customer_name}}, we've added tracking to your order. Use the number below on the courier's website to follow your package.")}
${orderStrip([{ label: "Stage", value: "In transit" }])}
${progress(3)}
${trackingPanel}
${viewOrder()}
${helpLine()}`,
  }),
};

tpl.order_delivered = {
  subject: "Your order {{order_number}} has arrived 💝",
  html: shell({
    title: "Delivered",
    preheader: "Your handmade Suthrayaa order has been delivered. We hope you love it!",
    body: `${eyebrow("Delivered", "green")}
${h1("It's home, {{customer_name}}!")}
${p("Your Suthrayaa order has been delivered. We hope it brings a little joy every time you see it — it was made with a lot of love.")}
${orderStrip([{ label: "Order total", value: "{{order_total}}" }])}
${progress(4, true)}
${sectionLabel("Caring for crochet")}
${steps([
  { title: "Gentle wash", body: "Hand wash in cool water with a mild detergent — no wringing." },
  { title: "Dry flat", body: "Reshape and lay flat to dry, away from direct sunlight." },
  { title: "Store softly", body: "Keep in a dry place; avoid hanging heavier pieces for long." },
])}
{{#if instagram_url}}${note(`Loved it? We'd be thrilled to see it in its new home — tag us on <a href="{{instagram_url}}" target="_blank" style="color:${T.peachDeep};font-weight:700;">Instagram</a>.`, "peach")}{{/if}}
${buttons(button("Shop again", "{{store_url}}"), "{{#if order_url}}" + button("View order", "{{order_url}}", "secondary") + "{{/if}}")}
${helpLine("Something not quite right?")}`,
  }),
};

tpl.order_cancelled = {
  subject: "Your order {{order_number}} has been cancelled",
  html: shell({
    title: "Order cancelled",
    preheader: "Your Suthrayaa order {{order_number}} has been cancelled.",
    body: `${eyebrow("Order cancelled", "red")}
${h1("Your order has been cancelled")}
${p("Hi {{customer_name}}, your order <strong style=\"color:" + T.ink + ";\">{{order_number}}</strong> has been cancelled and won't be made or shipped.")}
{{#if refund_amount}}${panel(kv([
  { label: "Refund amount", value: "{{refund_amount}}", strong: true },
  { label: "Refund status", value: "{{refund_status}}", color: T.green, cond: "refund_status" },
]), { tone: "green", icon: "&#8377;", title: "Your refund" })}{{/if}}
${sectionLabel("What happens next")}
${steps([
  { title: "Nothing more to do", body: "The order is closed — you won't be charged for anything further." },
  { title: "Paid online?", body: "Any refund goes back to your original payment method and usually shows in 5–7 business days, depending on your bank." },
])}
${buttons(button("Browse the shop", "{{store_url}}"))}
${helpLine("Didn't expect this?")}`,
  }),
};

tpl.payment_successful = {
  subject: "Payment received for order {{order_number}} ✓",
  html: shell({
    title: "Payment received",
    preheader: "We've received your payment of {{order_total}}. Thank you!",
    body: `${eyebrow("Payment received", "green")}
${h1("Thank you, {{customer_name}}!")}
${p("We've received your payment. Your order is now confirmed and moving to our makers.")}
${panel(kv([
  { label: "Amount paid", value: "{{order_total}}", strong: true },
  { label: "Order", value: "{{order_number}}" },
  { label: "Status", value: "&#10003; Paid", color: T.green },
]), { tone: "green", icon: "&#10003;", title: "Payment summary" })}
${progress(1)}
${viewOrder()}
${helpLine()}`,
  }),
};

tpl.payment_failed = {
  subject: "Payment didn't go through for {{order_number}}",
  html: shell({
    title: "Payment issue",
    preheader: "Your payment for order {{order_number}} couldn't be completed — you can try again.",
    body: `${eyebrow("Payment issue", "red")}
${h1("Your payment didn't go through")}
${p("Hi {{customer_name}}, we couldn't complete the payment for your order. Your items are still saved, and you can try again whenever you're ready.")}
${panel(kv([
  { label: "Order", value: "{{order_number}}" },
  { label: "Amount", value: "{{order_total}}", strong: true },
  { label: "Status", value: "Payment failed", color: T.red },
]), { tone: "red", icon: "!", title: "Payment details" })}
${note("If any amount was debited, your bank reverses failed payments automatically — usually within 5–7 business days.", "gold")}
{{#if order_url}}${buttons(button("Try payment again", "{{order_url}}"))}{{/if}}
${sectionLabel("Common fixes")}
${steps([
  { title: "Check your details", body: "Card number, expiry, CVV or UPI ID — a small typo is the usual culprit." },
  { title: "Try another method", body: "UPI, a different card or net banking often goes through first time." },
])}
${helpLine("Still stuck?")}`,
  }),
};

tpl.refund_processed = {
  subject: "Your refund for {{order_number}} has been processed",
  html: shell({
    title: "Refund processed",
    preheader: "Your refund of {{order_total}} is on its way back to you.",
    body: `${eyebrow("Refund processed", "gold")}
${h1("Your refund is on its way")}
${p("Hi {{customer_name}}, we've processed the refund for your order. It's been sent back to your original payment method.")}
${panel(kv([
  { label: "Refund amount", value: "{{order_total}}", strong: true },
  { label: "Order", value: "{{order_number}}" },
  { label: "Status", value: "&#10003; Processed", color: T.green },
]), { tone: "gold", icon: "&#8377;", title: "Refund details" })}
${note("Depending on your bank or payment provider, it usually takes 5–7 business days to appear in your account.", "violet")}
${buttons(button("Browse the shop", "{{store_url}}"))}
${helpLine("Questions about your refund?")}`,
  }),
};

tpl.invoice_email = {
  subject: "Your Suthrayaa invoice {{invoice_number}} for order {{order_number}}",
  html: shell({
    title: "Your invoice",
    preheader: "Invoice {{invoice_number}} for order {{order_number}} is attached as a PDF.",
    body: `${eyebrow("Invoice", "violet")}
${h1("Your invoice is attached")}
${p("Hi {{customer_name}}, thank you for shopping with Suthrayaa. Your invoice for order <strong style=\"color:" + T.ink + ";\">{{order_number}}</strong> is attached to this email as a PDF — keep it handy for your records.")}
${strip([{ label: "Invoice", value: "{{invoice_number}}", mono: true }, { label: "Order", value: "{{order_number}}", mono: true }])}
${panel(
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle" style="padding-right:14px;"><div style="width:44px;height:52px;line-height:52px;border-radius:8px;background:${T.ink};color:#FFFFFF;text-align:center;font-family:${SANS};font-size:11px;font-weight:800;letter-spacing:0.6px;">PDF</div></td>
    <td valign="middle"><p style="margin:0 0 3px;font-family:${SANS};font-size:14.5px;font-weight:700;color:${T.ink};">{{invoice_number}}.pdf</p>
    <p style="margin:0;font-family:${SANS};font-size:13px;color:${T.muted};">{{#if order_total}}Total {{order_total}} &middot; {{/if}}attached to this email</p></td>
  </tr></table>`,
  { bg: T.lilac }
)}
${viewOrder()}
${helpLine("Need a GST detail changed?")}`,
  }),
};

tpl.customer_welcome = {
  subject: "Welcome to Suthrayaa, {{customer_name}} 🧶",
  html: shell({
    title: "Welcome",
    preheader: "Handmade crochet, made to order — we're so glad you're here.",
    body: `${eyebrow("Welcome", "peach")}
${h1("So glad you're here, {{customer_name}}")}
${p("Welcome to Suthrayaa — a small studio making crochet flowers, bags, décor and gifts entirely by hand. Every piece is made in small batches, and many can be customised just for you.")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;"><tr>
  ${[
    { icon: "&#10047;", title: "Handmade", body: "Every stitch by hand, in small batches." },
    { icon: "&#9998;", title: "Made for you", body: "Pick colours, add names and notes." },
    { icon: "&#9825;", title: "Gift-ready", body: "Wrapped with care, ready to give." },
  ]
    .map(
      (f, i) => `<td class="stack" valign="top" width="33%" style="padding:${i ? "0 0 0 6px" : "0 6px 0 0"};${i === 1 ? "padding:0 6px;" : ""}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.lilac};border:1px solid ${T.border};border-radius:16px;"><tr><td style="padding:16px;">
      <div style="width:32px;height:32px;line-height:32px;border-radius:10px;background:${T.violetSoft};color:${T.violet};text-align:center;font-size:16px;">${f.icon}</div>
      <p style="margin:10px 0 3px;font-family:${SANS};font-size:14px;font-weight:700;color:${T.ink};">${f.title}</p>
      <p style="margin:0;font-family:${SANS};font-size:12.5px;line-height:1.55;color:${T.muted};">${f.body}</p>
    </td></tr></table>
  </td>`
    )
    .join("")}
</tr></table>
${buttons(button("Explore the shop", "{{store_url}}"))}
${helpLine("Looking for something special?")}`,
  }),
};

tpl.contact_enquiry_ack = {
  subject: "We've got your message, {{customer_name}}",
  html: shell({
    title: "Message received",
    preheader: "Thanks for reaching out — we'll reply within 1–2 business days.",
    body: `${eyebrow("Message received", "green")}
${h1("Thanks for writing to us, {{customer_name}}")}
${p("A real person on our team reads every message. We'll get back to you as soon as we can — usually within 1–2 business days.")}
${sectionLabel("Your message")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.lilac};border-radius:16px;border-left:4px solid ${T.violet};"><tr>
  <td style="padding:18px 20px;font-family:${SANS};font-size:14px;line-height:1.7;color:${T.text};">{{enquiry_message}}</td>
</tr></table>
${sectionLabel("Meanwhile")}
${steps([
  { title: "Browse our FAQs", body: `Answers on shipping, customisation and care live in our <a href="{{support_url}}" target="_blank" style="color:${T.violet};font-weight:700;text-decoration:none;">help centre</a>.` },
  { title: "Add anything we missed", body: "Just reply to this email — it lands in the same conversation." },
])}
${buttons(button("Continue shopping", "{{store_url}}"))}`,
  }),
};

/* ---------- admin notifications ---------- */

const adminCustomer = panel(
  kv([
    { label: "Customer", value: "{{customer_name}}" },
    { label: "Email", value: `<a href="mailto:{{customer_email}}" style="color:${T.violet};text-decoration:none;">{{customer_email}}</a>` },
  ]),
  { tone: "violet", icon: "&#9786;", title: "Customer" }
);

tpl.admin_new_order = {
  subject: "🛍️ New order {{order_number}} — {{order_total}}",
  html: shell({
    admin: true,
    title: "New order",
    preheader: "{{customer_name}} placed order {{order_number}} for {{order_total}}.",
    body: `${eyebrow("New order", "green")}
${h1("New order from {{customer_name}}")}
${p("A new order has just been placed on the storefront.")}
${strip([{ label: "Order", value: "{{order_number}}", mono: true }, { label: "Items", value: "{{item_count}}" }, { label: "Total", value: "{{order_total}}" }])}
${adminCustomer}
${sectionLabel("Items")}
{{items_table}}
${sectionLabel("Ship to")}
{{address_block}}
${buttons(button("Open orders", "{{store_url}}/admin/orders"))}`,
  }),
};

tpl.admin_new_enquiry = {
  subject: "💬 New enquiry from {{customer_name}}",
  html: shell({
    admin: true,
    title: "New enquiry",
    preheader: "{{customer_name}} sent a message through the contact form.",
    body: `${eyebrow("New enquiry", "violet")}
${h1("{{customer_name}} sent a message")}
${p("Someone reached out through the contact form. A quick, personal reply goes a long way.")}
${adminCustomer}
${sectionLabel("Message")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.lilac};border-radius:16px;border-left:4px solid ${T.peach};"><tr>
  <td style="padding:18px 20px;font-family:${SANS};font-size:14px;line-height:1.7;color:${T.text};">{{enquiry_message}}</td>
</tr></table>
${buttons(button("Reply to {{customer_name}}", "mailto:{{customer_email}}"))}`,
  }),
};

tpl.admin_payment_failed = {
  subject: "⚠️ Payment failed — {{order_number}}",
  html: shell({
    admin: true,
    title: "Payment failed",
    preheader: "Payment for {{order_number}} ({{order_total}}) didn't go through.",
    body: `${eyebrow("Payment failed", "red")}
${h1("A payment didn't go through")}
${p("The online payment for order <strong style=\"color:" + T.ink + ";\">{{order_number}}</strong> failed. The customer has been emailed a link to try again.")}
${strip([{ label: "Order", value: "{{order_number}}", mono: true }, { label: "Amount", value: "{{order_total}}" }])}
${adminCustomer}
${note("No action is usually needed — if the customer doesn't retry within a day, a friendly nudge often helps.", "gold")}
${buttons(button("Open orders", "{{store_url}}/admin/orders"))}`,
  }),
};

/* ============================================================ write */

for (const [type, t] of Object.entries(tpl)) {
  const html = t.html.replace(/\n\s*\n/g, "\n");
  writeFileSync(path.join(OUT, `${type}.html`), `<!-- SUBJECT: ${t.subject} -->\n${html}\n`);
  console.log(`wrote ${type}.html`);
}
console.log(`\n${Object.keys(tpl).length} templates written. Run scripts/sync-email-templates.ts to publish them.`);
