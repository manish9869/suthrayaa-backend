import { describe, it, expect } from "vitest";
import { computeGst, computeOrderGst } from "./tax.service.js";

describe("computeGst", () => {
  it("splits intra-state GST evenly into CGST + SGST", () => {
    const result = computeGst({
      amount: 1180,
      ratePercent: 18,
      sellerState: "Maharashtra",
      buyerState: "Maharashtra",
      pricesIncludeGst: true,
    });
    expect(result.isInterState).toBe(false);
    expect(result.igst).toBe(0);
    expect(result.cgst).toBe(result.sgst);
    expect(Math.round((result.cgst + result.sgst) * 100) / 100).toBe(result.totalTax);
  });

  it("charges the full rate as IGST for inter-state sales", () => {
    const result = computeGst({
      amount: 1180,
      ratePercent: 18,
      sellerState: "Maharashtra",
      buyerState: "Karnataka",
      pricesIncludeGst: true,
    });
    expect(result.isInterState).toBe(true);
    expect(result.cgst).toBe(0);
    expect(result.sgst).toBe(0);
    expect(result.igst).toBe(result.totalTax);
  });

  it("state comparison is case-insensitive and whitespace-tolerant", () => {
    const result = computeGst({
      amount: 1000,
      ratePercent: 18,
      sellerState: " Maharashtra ",
      buyerState: "maharashtra",
      pricesIncludeGst: true,
    });
    expect(result.isInterState).toBe(false);
  });

  it("inclusive pricing backs out the taxable value so total stays the same as the input amount", () => {
    const result = computeGst({
      amount: 1180,
      ratePercent: 18,
      sellerState: "Delhi",
      buyerState: "Delhi",
      pricesIncludeGst: true,
    });
    expect(result.taxableValue).toBe(1000);
    expect(result.totalTax).toBe(180);
    expect(result.totalWithTax).toBe(1180);
  });

  it("exclusive pricing adds tax on top of the given amount", () => {
    const result = computeGst({
      amount: 1000,
      ratePercent: 18,
      sellerState: "Delhi",
      buyerState: "Karnataka",
      pricesIncludeGst: false,
    });
    expect(result.taxableValue).toBe(1000);
    expect(result.totalTax).toBe(180);
    expect(result.totalWithTax).toBe(1180);
  });

  it("zero rate produces zero tax without error", () => {
    const result = computeGst({ amount: 500, ratePercent: 0, sellerState: "Goa", buyerState: "Kerala", pricesIncludeGst: true });
    expect(result.totalTax).toBe(0);
    expect(result.taxableValue).toBe(500);
  });
});

describe("computeOrderGst", () => {
  const base = { sellerState: "Maharashtra", buyerState: "Maharashtra", pricesIncludeGst: true };

  it("inclusive prices: taxable + tax equals exactly what the customer paid", () => {
    const r = computeOrderGst({ ...base, lines: [{ amount: 499, ratePercent: 5 }, { amount: 1098, ratePercent: 12 }], discount: 0, charges: [{ label: "Shipping", amount: 79 }] });
    expect(r.grandTotal).toBe(499 + 1098 + 79);
    for (const row of [...r.lines, ...r.charges]) {
      expect(Math.round((row.taxableValue + row.totalTax) * 100)).toBe(Math.round(row.gross * 100));
      expect(Math.round((row.cgst + row.sgst) * 100)).toBe(Math.round(row.totalTax * 100));
    }
    expect(r.lines[0].taxableValue).toBe(475.24);
    expect(r.lines[0].totalTax).toBe(23.76);
  });

  it("apportions the discount across lines before tax", () => {
    const r = computeOrderGst({ ...base, lines: [{ amount: 1000, ratePercent: 5 }, { amount: 500, ratePercent: 12 }], discount: 150, charges: [] });
    expect(r.grandTotal).toBe(1350);
    expect(r.lines[0].gross).toBe(900);
    expect(r.lines[1].gross).toBe(450);
  });

  it("taxes shipping and gift wrap at the principal (highest-value) line's rate and HSN", () => {
    const r = computeOrderGst({
      ...base,
      lines: [{ amount: 300, ratePercent: 18, hsn: "9503" }, { amount: 900, ratePercent: 5, hsn: "6117" }],
      discount: 0,
      charges: [{ label: "Shipping", amount: 105 }, { label: "Gift wrap", amount: 0 }],
    });
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0]).toMatchObject({ label: "Shipping", ratePercent: 5, hsn: "6117", taxableValue: 100, totalTax: 5 });
    expect(r.summary.map((s) => [s.hsn, s.ratePercent])).toEqual([["9503", 18], ["6117", 5]]);
    expect(r.summary[1].taxableValue).toBe(Math.round((900 / 1.05 + 100) * 100) / 100);
  });

  it("inter-state supplies carry IGST only", () => {
    const r = computeOrderGst({ ...base, buyerState: "Karnataka", lines: [{ amount: 1180, ratePercent: 18 }], discount: 0, charges: [] });
    expect(r.isInterState).toBe(true);
    expect(r.cgst + r.sgst).toBe(0);
    expect(r.igst).toBe(180);
  });

  it("exclusive prices add tax on top of the discounted value and charges", () => {
    const r = computeOrderGst({ ...base, pricesIncludeGst: false, lines: [{ amount: 1000, ratePercent: 12 }], discount: 100, charges: [{ label: "Shipping", amount: 50 }] });
    expect(r.taxableValue).toBe(950);
    expect(r.totalTax).toBe(114);
    expect(r.grandTotal).toBe(1064);
  });

  it("a 100% discount leaves nothing taxable on the goods", () => {
    const r = computeOrderGst({ ...base, lines: [{ amount: 200, ratePercent: 5 }], discount: 500, charges: [] });
    expect(r.grandTotal).toBe(0);
    expect(r.totalTax).toBe(0);
  });
});
