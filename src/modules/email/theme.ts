/**
 * Email design system shared by the generated templates (scripts/build-email-templates.ts)
 * and the emails assembled in code (email.service.ts): tokens, table-based components and the
 * branded shell. Everything is inline-styled and table-based for Gmail / Outlook / Apple Mail.
 */

/* ============================================================ tokens */

export const T = {
  canvas: "#F4F1FB",
  card: "#FFFFFF",
  ink: "#1C1642",
  inkSoft: "#2A2258",
  text: "#1F1A33",
  muted: "#6B6485",
  faint: "#A49CC0",
  border: "#EBE6F5",
  lilac: "#F7F5FC",
  violet: "#6D4AFF",
  violetSoft: "#EFEAFF",
  lilacText: "#C9BEFF",
  peach: "#FF9E7A",
  peachDeep: "#E9774F",
  peachSoft: "#FFF1EA",
  green: "#15803D",
  greenSoft: "#E6F6EC",
  red: "#B42318",
  redSoft: "#FDECEA",
  gold: "#A15C07",
  goldSoft: "#FEF3DC",
};
export const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
export const SANS = "'Plus Jakarta Sans', 'Segoe UI', Helvetica, Arial, sans-serif";
export const LOGO_WHITE = "https://uvctijaxxvddtzuqivse.supabase.co/storage/v1/object/public/hero-media/branding/suthrayaa-logo-white.png";

export type Tone = "violet" | "green" | "peach" | "red" | "gold";
const TONES: Record<Tone, { fg: string; bg: string }> = {
  violet: { fg: T.violet, bg: T.violetSoft },
  green: { fg: T.green, bg: T.greenSoft },
  peach: { fg: T.peachDeep, bg: T.peachSoft },
  red: { fg: T.red, bg: T.redSoft },
  gold: { fg: T.gold, bg: T.goldSoft },
};

/* ============================================================ components */

export const p = (html: string, o: { size?: number; color?: string; mt?: number; mb?: number; align?: string; weight?: number } = {}) =>
  `<p style="margin:${o.mt ?? 0}px 0 ${o.mb ?? 14}px;font-family:${SANS};font-size:${o.size ?? 15}px;line-height:1.65;color:${o.color ?? T.muted};${o.align ? `text-align:${o.align};` : ""}${o.weight ? `font-weight:${o.weight};` : ""}">${html}</p>`;

export const eyebrow = (label: string, tone: Tone) => {
  const c = TONES[tone];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>
      <td style="background:${c.bg};border-radius:999px;padding:6px 13px 6px 11px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${c.fg};">
        <span style="display:inline-block;width:7px;height:7px;border-radius:7px;background:${c.fg};vertical-align:1px;margin-right:7px;"></span>${label}
      </td></tr></table>`;
};

export const h1 = (html: string) =>
  `<h1 class="h1" style="margin:0 0 12px;font-family:${SERIF};font-weight:500;font-size:30px;line-height:1.2;letter-spacing:-0.4px;color:${T.ink};">${html}</h1>`;

export const sectionLabel = (label: string, right = "") =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 12px;"><tr>
    <td style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${T.peachDeep};">${label}</td>
    ${right ? `<td align="right" style="font-family:${SANS};font-size:12px;color:${T.muted};">${right}</td>` : ""}
  </tr></table>`;

/** A bulletproof pill button (VML-free; renders as a padded link everywhere). */
export const button = (label: string, href: string, variant: "primary" | "secondary" = "primary") => {
  const primary = variant === "primary";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr>
    <td align="center" bgcolor="${primary ? T.violet : T.card}" style="border-radius:999px;${primary ? "" : `border:1.5px solid ${T.border};`}">
      <a href="${href}" target="_blank" style="display:inline-block;padding:${primary ? "14px 28px" : "12.5px 24px"};font-family:${SANS};font-size:14px;font-weight:700;color:${primary ? "#FFFFFF" : T.ink};text-decoration:none;border-radius:999px;">${label}&nbsp;&nbsp;&rarr;</a>
    </td></tr></table>`;
};

export const buttons = (...btns: string[]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;"><tr>${btns
    .map((b, i) => `<td style="padding-right:${i < btns.length - 1 ? 10 : 0}px;padding-bottom:8px;">${b}</td>`)
    .join("")}</tr></table>`;

/** The lilac "order strip": up to four label/value cells in one rounded band. */
export const strip = (cells: { label: string; value: string; mono?: boolean }[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;background:${T.lilac};border:1px solid ${T.border};border-radius:16px;"><tr>
    ${cells
      .map(
        (c, i) => `<td class="stack stack-box" valign="top" style="padding:16px 20px;${i ? `border-left:1px solid ${T.border};` : ""}">
      <p style="margin:0 0 5px;font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${T.faint};">${c.label}</p>
      <p style="margin:0;font-family:${c.mono ? SANS : SANS};font-size:16px;font-weight:700;color:${T.ink};letter-spacing:${c.mono ? "0.4px" : "0"};">${c.value}</p>
    </td>`
      )
      .join("")}
  </tr></table>`;

const PROGRESS = ["Placed", "Confirmed", "Handmade", "Shipped", "Delivered"];
/** Five-step order journey. `done` steps are violet, the current one peach, the rest lilac. */
export const progress = (current: number, allDone = false) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px;"><tr>
    ${PROGRESS.map((label, i) => {
      const done = allDone || i < current;
      const now = !allDone && i === current;
      const bar = done ? T.violet : now ? T.peach : T.border;
      const color = done ? T.ink : now ? T.peachDeep : T.faint;
      return `<td width="20%" valign="top" style="padding:0 ${i < 4 ? 4 : 0}px 0 ${i ? 4 : 0}px;">
        <div style="height:5px;line-height:5px;font-size:1px;border-radius:5px;background:${bar};">&nbsp;</div>
        <p style="margin:9px 0 0;font-family:${SANS};font-size:11.5px;font-weight:${done || now ? 700 : 500};color:${color};">${done ? "&#10003;&nbsp;" : ""}${label}</p>
      </td>`;
    }).join("")}
  </tr></table>`;

/** A soft rounded panel with an optional icon badge + title. */
export const panel = (inner: string, o: { tone?: Tone; icon?: string; title?: string; bg?: string } = {}) => {
  const c = TONES[o.tone ?? "violet"];
  const head = o.title
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr>
        ${o.icon ? `<td valign="middle" style="padding-right:10px;"><div style="width:30px;height:30px;line-height:30px;border-radius:10px;background:${c.bg};color:${c.fg};text-align:center;font-family:${SANS};font-size:15px;font-weight:700;">${o.icon}</div></td>` : ""}
        <td valign="middle" style="font-family:${SANS};font-size:15px;font-weight:700;color:${T.ink};">${o.title}</td></tr></table>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;background:${o.bg ?? T.card};border:1px solid ${T.border};border-radius:16px;"><tr><td style="padding:18px 20px;">${head}${inner}</td></tr></table>`;
};

/** Key/value rows (label left, value right) — used for payment, refund and order details. */
export const kv = (rows: { label: string; value: string; strong?: boolean; color?: string; cond?: string }[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${rows
      .map((r, i) => {
        const row = `<tr>
        <td style="padding:9px 0;${i ? `border-top:1px solid ${T.border};` : ""}font-family:${SANS};font-size:14px;color:${T.muted};">${r.label}</td>
        <td align="right" style="padding:9px 0;${i ? `border-top:1px solid ${T.border};` : ""}font-family:${SANS};font-size:14px;font-weight:${r.strong ? 800 : 600};color:${r.color ?? T.ink};">${r.value}</td>
      </tr>`;
        return r.cond ? `{{#if ${r.cond}}}${row}{{/if}}` : row;
      })
      .join("")}
  </table>`;

/** Numbered "what happens next" list. */
export const steps = (items: { title: string; body: string }[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${items
      .map(
        (s, i) => `<tr>
      <td valign="top" width="40" style="padding:${i ? 14 : 2}px 0 0;">
        <div style="width:28px;height:28px;line-height:28px;border-radius:28px;background:${T.violetSoft};color:${T.violet};text-align:center;font-family:${SANS};font-size:13px;font-weight:800;">${i + 1}</div>
      </td>
      <td valign="top" style="padding:${i ? 14 : 2}px 0 0;">
        <p style="margin:3px 0 2px;font-family:${SANS};font-size:14.5px;font-weight:700;color:${T.ink};">${s.title}</p>
        <p style="margin:0;font-family:${SANS};font-size:13.5px;line-height:1.6;color:${T.muted};">${s.body}</p>
      </td></tr>`
      )
      .join("")}
  </table>`;

/** Callout line with a tinted background. */
export const note = (html: string, tone: Tone = "violet") => {
  const c = TONES[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;"><tr>
    <td style="background:${c.bg};border-radius:14px;padding:14px 18px;font-family:${SANS};font-size:13.5px;line-height:1.6;color:${c.fg};">${html}</td></tr></table>`;
};

/** Line items from {{#each order_items}} (product image, name, colour, qty, total). */
export const itemsEach = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${T.border};border-radius:16px;">
  {{#each order_items}}<tr>
    <td valign="middle" width="76" style="padding:14px 0 14px 16px;border-bottom:1px solid ${T.border};">
      {{#if product_image}}<img src="{{product_image}}" alt="" width="60" height="60" style="display:block;width:60px;height:60px;border-radius:12px;object-fit:cover;background:${T.lilac};"/>{{else}}<div style="width:60px;height:60px;border-radius:12px;background:${T.violetSoft};"></div>{{/if}}
    </td>
    <td valign="middle" style="padding:14px 12px;border-bottom:1px solid ${T.border};">
      <p style="margin:0 0 3px;font-family:${SANS};font-size:14.5px;font-weight:700;color:${T.ink};">{{product_name}}</p>
      <p style="margin:0;font-family:${SANS};font-size:12.5px;color:${T.muted};">{{#if variant_name}}{{variant_name}} &middot; {{/if}}Qty {{quantity}}</p>
    </td>
    <td valign="middle" align="right" style="padding:14px 16px 14px 0;border-bottom:1px solid ${T.border};white-space:nowrap;">
      <p style="margin:0;font-family:${SANS};font-size:14.5px;font-weight:700;color:${T.ink};">{{item_total}}</p>
      {{#if has_discount}}<p style="margin:2px 0 0;font-family:${SANS};font-size:12px;color:${T.faint};text-decoration:line-through;">{{original_item_total}}</p>{{/if}}
    </td>
  </tr>{{/each}}
</table>`;

/** Totals block for templates that receive the full order variable set. */
export const totals = (totalVar: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0;">
    <tr><td style="padding:6px 4px;font-family:${SANS};font-size:14px;color:${T.muted};">Subtotal</td><td align="right" style="padding:6px 4px;font-family:${SANS};font-size:14px;font-weight:600;color:${T.ink};">{{subtotal}}</td></tr>
    {{#if has_discount}}<tr><td style="padding:6px 4px;font-family:${SANS};font-size:14px;color:${T.muted};">Discount{{#if coupon_code}} <span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${T.greenSoft};color:${T.green};font-size:11.5px;font-weight:700;letter-spacing:0.4px;">{{coupon_code}}</span>{{/if}}</td><td align="right" style="padding:6px 4px;font-family:${SANS};font-size:14px;font-weight:600;color:${T.green};">&minus;{{discount}}</td></tr>{{/if}}
    <tr><td style="padding:6px 4px;font-family:${SANS};font-size:14px;color:${T.muted};">Shipping</td><td align="right" style="padding:6px 4px;font-family:${SANS};font-size:14px;font-weight:600;color:${T.ink};">{{shipping}}</td></tr>
    {{#if has_tax}}<tr><td style="padding:6px 4px;font-family:${SANS};font-size:13px;color:${T.faint};">Includes GST</td><td align="right" style="padding:6px 4px;font-family:${SANS};font-size:13px;color:${T.faint};">{{tax}}</td></tr>{{/if}}
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 0;background:${T.ink};border-radius:16px;"><tr>
    <td style="padding:18px 22px;font-family:${SANS};font-size:11.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${T.lilacText};">Total</td>
    <td align="right" style="padding:18px 22px;font-family:${SERIF};font-size:26px;font-weight:500;color:#FFFFFF;">{{${totalVar}}}</td>
  </tr></table>`;

/** Shipping address + payment, side by side (stacks on phones). */
export const shipAndPay = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tr>
  <td class="stack" valign="top" width="50%" style="padding-right:8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.lilac};border:1px solid ${T.border};border-radius:16px;"><tr><td style="padding:16px 18px;">
      <p style="margin:0 0 8px;font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${T.faint};">Shipping to</p>
      <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.6;color:${T.text};"><strong style="color:${T.ink};">{{shipping_name}}</strong><br/>{{shipping_address_line1}}{{#if shipping_address_line2}}, {{shipping_address_line2}}{{/if}}<br/>{{shipping_city}}, {{shipping_state}} {{shipping_pincode}}{{#if shipping_phone}}<br/><span style="color:${T.muted};">{{shipping_phone}}</span>{{/if}}</p>
    </td></tr></table>
  </td>
  <td class="stack" valign="top" width="50%" style="padding-left:8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.lilac};border:1px solid ${T.border};border-radius:16px;"><tr><td style="padding:16px 18px;">
      <p style="margin:0 0 8px;font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:${T.faint};">Payment</p>
      <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.6;color:${T.text};"><strong style="color:${T.ink};">{{payment_method}}</strong><br/><span style="color:${T.muted};">Status: {{payment_status}}</span></p>
    </td></tr></table>
  </td>
</tr></table>`;

export const helpLine = (lead = "Questions about your order?") =>
  p(
    `${lead} Just reply to this email or <a href="{{contact_url}}" target="_blank" style="color:${T.violet};font-weight:700;text-decoration:none;">contact us</a> — a real person on our team reads every message.`,
    { size: 13.5, mt: 26, mb: 0 }
  );

/* ============================================================ shell */

/** Footer link targets: template placeholders by default, or concrete URLs for code-built mail. */
export interface ShellLinks {
  store: string;
  support: string;
  contact: string;
  year: string;
  instagram?: string;
  facebook?: string;
}
const PLACEHOLDER_LINKS: ShellLinks = {
  store: "{{store_url}}",
  support: "{{support_url}}",
  contact: "{{contact_url}}",
  year: "{{current_year}}",
  instagram: "{{instagram_url}}",
  facebook: "{{facebook_url}}",
};

export function shell(o: { title: string; preheader: string; body: string; admin?: boolean; links?: ShellLinks }) {
  const L = o.links ?? PLACEHOLDER_LINKS;
  const templated = !o.links;
  const social = (label: string, url: string | undefined, key: string) =>
    templated
      ? `{{#if ${key}}}&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${url}" target="_blank" style="color:${T.lilacText};text-decoration:none;">${label}</a>{{/if}}`
      : url
        ? `&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${url}" target="_blank" style="color:${T.lilacText};text-decoration:none;">${label}</a>`
        : "";
  const footerLinks = o.admin
    ? `<a href="${L.store}/admin" target="_blank" style="color:${T.lilacText};text-decoration:none;">Admin console</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${L.store}" target="_blank" style="color:${T.lilacText};text-decoration:none;">Storefront</a>`
    : `<a href="${L.store}" target="_blank" style="color:${T.lilacText};text-decoration:none;">Shop</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${L.support}" target="_blank" style="color:${T.lilacText};text-decoration:none;">Help</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${L.contact}" target="_blank" style="color:${T.lilacText};text-decoration:none;">Contact</a>${social("Instagram", L.instagram, "instagram_url")}${social("Facebook", L.facebook, "facebook_url")}`;

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${o.title}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&amp;family=Plus+Jakarta+Sans:wght@400;600;700;800&amp;display=swap" rel="stylesheet"/>
<style>
  body{margin:0;padding:0;background:${T.canvas};-webkit-text-size-adjust:100%;}
  a{color:${T.violet};}
  @media only screen and (max-width:620px){
    .container{width:100%!important;border-radius:0!important;}
    .px{padding-left:22px!important;padding-right:22px!important;}
    .h1{font-size:25px!important;}
    .stack{display:block!important;width:100%!important;padding-left:0!important;padding-right:0!important;border-left:0!important;}
    .stack + .stack{padding-top:12px!important;}
    .stack-box{padding:14px 18px!important;box-sizing:border-box!important;}
    .stack-box + .stack-box{border-top:1px solid ${T.border}!important;padding-top:14px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${T.canvas};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${o.preheader}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.canvas}" style="background:${T.canvas};">
<tr><td align="center" style="padding:28px 12px 36px;">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${T.card};border-radius:24px;overflow:hidden;border:1px solid ${T.border};">

    <!-- header: ink band, white logo, stitched divider -->
    <tr><td bgcolor="${T.ink}" class="px" style="background:${T.ink};padding:26px 36px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" width="64"><img src="${LOGO_WHITE}" alt="Suthrayaa" width="56" style="display:block;width:56px;height:auto;"/></td>
        <td valign="middle" style="padding-left:12px;">
          <p style="margin:0;font-family:${SERIF};font-size:23px;font-weight:500;color:#FFFFFF;letter-spacing:-0.2px;">Suthrayaa</p>
          <p style="margin:2px 0 0;font-family:${SERIF};font-style:italic;font-size:13px;color:${T.lilacText};">${o.admin ? "Admin notification" : "Handcrafted crochet, made to order"}</p>
        </td>
      </tr></table>
      <div style="margin-top:22px;border-top:2px dashed ${T.peach};opacity:0.9;height:0;line-height:0;font-size:0;">&nbsp;</div>
      <div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
    </td></tr>

    <!-- body -->
    <tr><td class="px" style="padding:34px 36px 36px;">
${o.body}
    </td></tr>

    <!-- sign-off strip -->
    <tr><td class="px" style="padding:0 36px 30px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${T.border};"><tr>
        <td style="padding-top:20px;font-family:${SERIF};font-style:italic;font-size:15px;color:${T.ink};">${o.admin ? "— Suthrayaa store" : "With love &amp; yarn, <br/>the Suthrayaa team"}</td>
        <td align="right" style="padding-top:20px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${T.faint};">Handmade in India</td>
      </tr></table>
    </td></tr>

    <!-- footer -->
    <tr><td bgcolor="${T.ink}" align="center" class="px" style="background:${T.ink};padding:28px 36px 30px;">
      <div style="margin:0 auto 18px;width:120px;border-top:2px dashed ${T.peach};opacity:0.7;height:0;line-height:0;font-size:0;">&nbsp;</div>
      <p style="margin:0 0 10px;font-family:${SANS};font-size:13px;font-weight:600;">${footerLinks}</p>
      <p style="margin:0;font-family:${SANS};font-size:11.5px;line-height:1.6;color:#8E86B5;">&copy; ${L.year} Suthrayaa &middot; Handcrafted crochet, made in small batches.</p>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

