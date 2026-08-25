import { describe, it, expect } from "vitest";
import { computeGst } from "./tax.service.js";

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
