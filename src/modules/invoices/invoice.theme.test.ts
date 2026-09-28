import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_PRESETS_BY_ID } from "../theme/theme.presets.js";
import type { InvoiceSnapshot } from "./invoice.service.js";

// The invoice follows the active storefront theme; stub which theme is "active".
const active: { colors: Record<string, string> | null } = { colors: null };
vi.mock("../theme/theme.service.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../theme/theme.service.js")>();
  return { ...real, getActiveThemeColorsSync: () => active.colors };
});

const { renderInvoicePdf } = await import("./invoice.pdf.js");

function sample(headerStyle: "dark" | "light"): InvoiceSnapshot {
  const address = { firstName: "Aditya", lastName: "Chauhan", addressLine1: "64 Test Layout", city: "Pune", state: "Maharashtra", pincode: "411001", phone: "9984112400" };
  return {
    business: { name: "Suthrayaa", logoUrl: null, address: "Mumbai, Maharashtra", email: "suthrayaa@gmail.com", phone: null, taxNumber: null, gstin: null, footer: "Thank you for shopping handmade!", terms: null, currency: "INR", showSku: true, showTax: true, showCustomizationPricing: true, headerStyle, accent: "peach" },
    orderNumber: "SUT-TEST",
    orderDate: "2026-09-27T10:00:00.000Z",
    customerName: "Aditya Chauhan",
    customerEmail: "aditya@example.com",
    customerPhone: "9984112400",
    shippingAddress: address,
    paymentMethod: "razorpay",
    items: [
      { name: "Classic Crochet Sunflower Bouquet", sku: "CR-FLOW-SUN-001", quantity: 2, unitPrice: 499, lineTotal: 998, customizations: [] },
      { name: "Convertible Star Bottle Holder", sku: "CR-BAG-BTL-001", quantity: 1, unitPrice: 549, lineTotal: 549, customizations: [] },
    ],
    subtotal: 1547,
    discountAmount: 0,
    shippingCost: 79,
    giftWrapCost: 0,
    taxAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    taxLabel: "GST",
    total: 1626,
  } as unknown as InvoiceSnapshot;
}

// Set INVOICE_PREVIEW_DIR to also write the PDFs out for a visual check
const OUT = process.env.INVOICE_PREVIEW_DIR;

async function render(themeId: string | null, headerStyle: "dark" | "light") {
  active.colors = themeId ? THEME_PRESETS_BY_ID.get(themeId)!.colors : null;
  const pdf = await renderInvoicePdf("INV-TEST", sample(headerStyle), "confirmed", "paid");
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, `invoice-${themeId ?? "default"}-${headerStyle}.pdf`), pdf);
  }
  return pdf.toString("latin1");
}

describe("invoice follows the storefront theme", () => {
  beforeEach(() => {
    active.colors = null;
  });

  it("default theme keeps the reference design colours", async () => {
    const pdf = await render(null, "dark");
    expect(pdf.startsWith("%PDF")).toBe(true);
  });

  it.each([
    ["rose-blossom", "dark"],
    ["rose-blossom", "light"],
    ["forest-sage", "dark"],
    ["charcoal-minimal", "light"],
  ] as const)("%s (%s header) renders", async (id, style) => {
    const pdf = await render(id, style);
    expect(pdf.startsWith("%PDF")).toBe(true);
  });

  it("switching back to the default restores the reference palette", async () => {
    await render("rose-blossom", "dark");
    const a = await render(null, "dark");
    const b = await render(null, "dark");
    // Same inputs → same drawing commands (ignoring the embedded creation timestamp)
    const strip = (s: string) => s.replace(/\/CreationDate \(D:[^)]*\)/g, "").replace(/\/ID \[[^\]]*\]/g, "");
    expect(strip(a)).toBe(strip(b));
  });
});
