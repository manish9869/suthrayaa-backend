import { describe, it, expect } from "vitest";
import { SETTINGS, SETTINGS_BY_KEY, groupKeys, SENSITIVE_GROUP_PERMISSION } from "./settings.catalog.js";

describe("settings catalog consistency", () => {
  it("has no duplicate keys", () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every key follows group.name convention matching its declared group prefix loosely (non-empty group)", () => {
    for (const s of SETTINGS) {
      expect(s.group.length).toBeGreaterThan(0);
      expect(s.key).toContain(".");
    }
  });

  it("select-type settings always declare their options", () => {
    for (const s of SETTINGS) {
      if (s.type === "select") expect(s.options && s.options.length > 0).toBe(true);
    }
  });

  it("groupKeys() returns exactly the keys in that group", () => {
    const taxKeys = groupKeys("tax");
    expect(taxKeys.length).toBeGreaterThan(0);
    for (const key of taxKeys) expect(SETTINGS_BY_KEY.get(key)?.group).toBe("tax");
  });
});

describe("public/sensitive separation — never leak GST/payment/email/maintenance details publicly", () => {
  it("no key in the tax, payment, or email groups is public", () => {
    for (const s of SETTINGS) {
      if (["tax", "payment", "email"].includes(s.group)) {
        expect(s.isPublic, `${s.key} must not be public`).toBe(false);
      }
    }
  });

  it("business (GST/PAN-adjacent) settings are never public", () => {
    for (const s of SETTINGS.filter((s) => s.group === "business")) {
      expect(s.isPublic, `${s.key} must not be public`).toBe(false);
    }
  });

  it("every SENSITIVE_GROUP_PERMISSION entry maps to a group that actually exists", () => {
    const groups = new Set(SETTINGS.map((s) => s.group));
    for (const group of Object.keys(SENSITIVE_GROUP_PERMISSION)) {
      expect(groups.has(group), `SENSITIVE_GROUP_PERMISSION references unknown group "${group}"`).toBe(true);
    }
  });
});

describe("India-first defaults", () => {
  it("store defaults to India/INR/₹/Asia-Kolkata/en-IN", () => {
    expect(SETTINGS_BY_KEY.get("store.country")?.default).toBe("India");
    expect(SETTINGS_BY_KEY.get("store.currency")?.default).toBe("INR");
    expect(SETTINGS_BY_KEY.get("store.currency_symbol")?.default).toBe("₹");
    expect(SETTINGS_BY_KEY.get("store.timezone")?.default).toBe("Asia/Kolkata");
    expect(SETTINGS_BY_KEY.get("store.locale")?.default).toBe("en-IN");
  });

  it("GST is off and COD is on by default — no assumption about registration status", () => {
    expect(SETTINGS_BY_KEY.get("tax.gst_enabled")?.default).toBe(false);
    expect(SETTINGS_BY_KEY.get("payment.cod_enabled")?.default).toBe(true);
  });

  it("shipping defaults reproduce today's hardcoded checkout constants exactly", () => {
    expect(SETTINGS_BY_KEY.get("shipping.default_fee")?.default).toBe(60);
    expect(SETTINGS_BY_KEY.get("shipping.express_surcharge")?.default).toBe(90);
    expect(SETTINGS_BY_KEY.get("shipping.free_shipping_threshold")?.default).toBe(999);
    expect(SETTINGS_BY_KEY.get("shipping.free_shipping_enabled")?.default).toBe(true);
    expect(SETTINGS_BY_KEY.get("shipping.gift_wrap_fee")?.default).toBe(49);
  });
});
