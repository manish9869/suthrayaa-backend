/** Full regression pass: renders every template with a realistic, comprehensive variable set
 * (matching what real call sites now supply), flags any leftover unresolved {{...}} tokens,
 * and sends each one to the superadmin inbox for review. Delete after use. */
import { supabaseAdmin } from "../src/config/supabase.js";
import { substituteTemplate, renderFinalEmailHtml, resendLoggedEmail } from "../src/modules/email/email.service.js";

const TO = "manishchavan016@gmail.com";

const SAMPLE_VARIABLES: Record<string, string> = {
  customer_name: "Priya Sharma",
  customer_email: "priya.sharma@example.com",
  order_number: "ORD-2026-0042",
  order_date: new Date().toLocaleDateString("en-IN"),
  order_total: "₹1,499",
  tracking_number: "TRACK123456",
  tracking_url: "",
  product_name: "Crochet Sunflower Pot",
  invoice_number: "INV-2026-0042",
  store_name: "Suthrayaa",
  enquiry_message: "<strong>Question about shipping</strong><br/><br/>Hi! Do you ship outside India?",
  item_count: "2",
  subtotal: "₹1,598",
  has_discount: "true",
  discount: "₹99",
  coupon_code: "WELCOME10",
  shipping: "₹0",
  has_tax: "false",
  tax: "₹0",
  total: "₹1,499",
  payment_status: "Paid",
  payment_method: "Online Payment",
  refund_status: "Refunded",
  refund_amount: "₹1,499",
  shipping_name: "Priya Sharma",
  shipping_address_line1: "12 Lotus Apartments, MG Road",
  shipping_address_line2: "Near City Mall",
  shipping_city: "Pune",
  shipping_state: "Maharashtra",
  shipping_pincode: "411001",
  shipping_country: "India",
  shipping_phone: "+91 98765 43210",
  order_url: "https://suthrayaa.com/order-confirmation?order=ORD-2026-0042",
  store_url: "https://suthrayaa.com",
  support_url: "https://suthrayaa.com/faqs",
  contact_url: "https://suthrayaa.com/contact",
  instagram_url: "https://instagram.com/suthrayaa",
  facebook_url: "https://facebook.com/suthrayaa",
  current_year: String(new Date().getFullYear()),
};
const SAMPLE_RAW: Record<string, string> = {
  items_table: `<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFAFD;border:1px solid #F1E5EB;border-radius:12px;"><tr><td style="padding:14px 20px;">Crochet Sunflower Pot — Qty 1</td><td style="padding:14px 20px;text-align:right;">₹899</td></tr></table>`,
  address_block: `<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFAFD;border:1px solid #F1E5EB;border-radius:12px;"><tr><td style="padding:16px 20px;">Priya Sharma<br/>12 Lotus Apartments, MG Road<br/>Pune, Maharashtra 411001</td></tr></table>`,
};
const SAMPLE_LISTS: Record<string, Array<Record<string, string>>> = {
  order_items: [
    {
      product_image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Suthraya%20Logo%20-%20Trans-HgT4V8esTeOZ2PwWy5B7QcPjLLrahf.png",
      product_name: "Crochet Sunflower Pot",
      variant_name: "Yellow",
      quantity: "1",
      item_total: "₹899",
      has_discount: "false",
      original_item_total: "",
    },
    {
      product_image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Suthraya%20Logo%20-%20Trans-HgT4V8esTeOZ2PwWy5B7QcPjLLrahf.png",
      product_name: "Mini Amigurumi Bear",
      variant_name: "",
      quantity: "1",
      item_total: "₹699",
      has_discount: "true",
      original_item_total: "₹799",
    },
  ],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: templates, error } = await supabaseAdmin.from("email_templates").select("*").order("type");
  if (error) throw error;
  if (!templates?.length) {
    console.log("No templates found.");
    return;
  }

  let anyLeftovers = false;
  for (const template of templates) {
    const subject = substituteTemplate(template.subject, SAMPLE_VARIABLES, SAMPLE_RAW, SAMPLE_LISTS);
    const bodyHtml = substituteTemplate(template.body_html, SAMPLE_VARIABLES, SAMPLE_RAW, SAMPLE_LISTS);
    const html = renderFinalEmailHtml(template.type, subject, bodyHtml, SAMPLE_VARIABLES.order_number);

    const leftovers = [...html.matchAll(/\{\{\/?[#a-zA-Z][\w]*\}\}/g)].map((m) => m[0]);
    const uniqueLeftovers = [...new Set(leftovers)];
    if (uniqueLeftovers.length) {
      anyLeftovers = true;
      console.log(`⚠ ${template.type}: UNRESOLVED -> ${uniqueLeftovers.join(", ")}`);
    } else {
      console.log(`✓ ${template.type}: fully resolved`);
    }

    await resendLoggedEmail(TO, `[REGRESSION] ${template.type}: ${subject}`, html);
    await sleep(600);
  }
  console.log(anyLeftovers ? "\nSome templates have unresolved placeholders — see above." : "\nAll templates fully resolved. All sent.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
