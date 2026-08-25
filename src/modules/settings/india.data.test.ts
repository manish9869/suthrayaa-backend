import { describe, it, expect } from "vitest";
import { INDIA_STATES, isValidIndianState, isValidIndianMobile, isValidIndianPincode, isValidGstin, isValidPan } from "./india.data.js";

describe("INDIA_STATES", () => {
  it("has 28 states + 8 union territories = 36 entries", () => {
    expect(INDIA_STATES.length).toBe(36);
    expect(INDIA_STATES.filter((s) => !s.isUnionTerritory).length).toBe(28);
    expect(INDIA_STATES.filter((s) => s.isUnionTerritory).length).toBe(8);
  });

  it("has no duplicate names or state codes", () => {
    expect(new Set(INDIA_STATES.map((s) => s.name)).size).toBe(36);
    expect(new Set(INDIA_STATES.map((s) => s.code)).size).toBe(36);
  });
});

describe("isValidIndianState", () => {
  it("accepts a real state", () => expect(isValidIndianState("Maharashtra")).toBe(true));
  it("rejects a fake state", () => expect(isValidIndianState("Narnia")).toBe(false));
});

describe("isValidIndianMobile", () => {
  it.each(["9876543210", "6000000000"])("accepts %s", (v) => expect(isValidIndianMobile(v)).toBe(true));
  it.each(["5876543210", "98765432", "98765432100", "abcdefghij"])("rejects %s", (v) => expect(isValidIndianMobile(v)).toBe(false));
});

describe("isValidIndianPincode", () => {
  it.each(["400001", "110001"])("accepts %s", (v) => expect(isValidIndianPincode(v)).toBe(true));
  it.each(["000001", "12345", "1234567", "abcdef"])("rejects %s", (v) => expect(isValidIndianPincode(v)).toBe(false));
});

describe("isValidGstin", () => {
  it("accepts a well-formed GSTIN", () => expect(isValidGstin("22AAAAA0000A1Z5")).toBe(true));
  it("rejects a malformed GSTIN", () => expect(isValidGstin("not-a-gstin")).toBe(false));
});

describe("isValidPan", () => {
  it("accepts a well-formed PAN", () => expect(isValidPan("AAAAA0000A")).toBe(true));
  it("rejects a malformed PAN", () => expect(isValidPan("12345")).toBe(false));
});
