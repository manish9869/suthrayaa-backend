import { describe, expect, it } from "vitest";
import { bucketKey, buckets, compareRange, presetRange, resolvePeriod, shiftMonths, weekStart } from "./period.js";
import { gaBucketKey } from "./ga.js";
import { filterNotes, filterOrders, gaFilter, parseFilters } from "./filters.js";

const TODAY = "2026-09-29"; // a Tuesday
const tz = "Asia/Kolkata";
const now = new Date("2026-09-29T08:00:00+05:30");

describe("date presets", () => {
  it("resolves every preset in the store's calendar", () => {
    expect(presetRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(presetRange("yesterday", TODAY)).toEqual({ from: "2026-09-28", to: "2026-09-28" });
    expect(presetRange("last_7_days", TODAY)).toEqual({ from: "2026-09-23", to: TODAY });
    expect(presetRange("last_14_days", TODAY).from).toBe("2026-09-16");
    expect(presetRange("last_30_days", TODAY).from).toBe("2026-08-31");
    expect(presetRange("last_90_days", TODAY).from).toBe("2026-07-02");
    expect(presetRange("this_week", TODAY)).toEqual({ from: "2026-09-28", to: TODAY });
    expect(presetRange("last_week", TODAY)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(presetRange("this_month", TODAY)).toEqual({ from: "2026-09-01", to: TODAY });
    expect(presetRange("last_month", TODAY)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("this_quarter", TODAY)).toEqual({ from: "2026-07-01", to: TODAY });
    expect(presetRange("last_quarter", TODAY)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(presetRange("this_year", TODAY)).toEqual({ from: "2026-01-01", to: TODAY });
    expect(presetRange("last_year", TODAY)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(presetRange("last_month", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("last_quarter", "2026-02-10")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
  });

  it("compares month-to-date with the same days last month (1–29 Sep vs 1–29 Aug)", () => {
    expect(compareRange("this_month", "2026-09-01", "2026-09-29", "previous")).toEqual({ from: "2026-08-01", to: "2026-08-29" });
    expect(compareRange("last_month", "2026-08-01", "2026-08-31", "previous")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(compareRange("last_quarter", "2026-04-01", "2026-06-30", "previous")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(compareRange("last_year", "2025-01-01", "2025-12-31", "previous")).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(compareRange("last_7_days", "2026-09-23", "2026-09-29", "previous")).toEqual({ from: "2026-09-16", to: "2026-09-22" });
    expect(compareRange("custom", "2026-09-01", "2026-09-10", "previous_year")).toEqual({ from: "2025-09-01", to: "2025-09-10" });
    expect(compareRange("custom", "2026-03-01", "2026-03-31", "previous")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(compareRange("custom", "2026-01-01", "2026-03-31", "previous")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(compareRange("custom", "2026-03-05", "2026-03-11", "previous")).toEqual({ from: "2026-02-26", to: "2026-03-04" });
    expect(compareRange("this_month", "2026-09-01", "2026-09-29", "none")).toBeNull();
    expect(shiftMonths("2024-02-29", -12)).toBe("2023-02-28");
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("parses the query, including a custom comparison, and picks the chart bucket size", () => {
    const p = resolvePeriod({ preset: "last_7_days" }, tz, now);
    expect(p).toMatchObject({ from: "2026-09-23", to: TODAY, compareFrom: "2026-09-16", compareTo: "2026-09-22", granularity: "day" });
    expect(p.since).toBe("2026-09-22T18:30:00.000Z"); // midnight IST
    const c = resolvePeriod({ from: "2026-01-01", to: "2026-06-30", compare: "custom", compareFrom: "2025-01-01", compareTo: "2025-06-30" }, tz, now);
    expect(c).toMatchObject({ preset: "custom", granularity: "week", compareFrom: "2025-01-01" });
    expect(resolvePeriod({ preset: "last_year" }, tz, now).granularity).toBe("month");
    expect(resolvePeriod({ preset: "last_30_days", granularity: "week" }, tz, now).granularity).toBe("week");
    expect(() => resolvePeriod({ from: "2026-02-01", to: "2026-01-01" }, tz, now)).toThrow();
    expect(() => resolvePeriod({ preset: "today", compare: "custom" }, tz, now)).toThrow();
  });

  it("buckets days into weeks (Monday) and months, matching GA4's week/month values", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // Sunday → previous Monday
    expect(buckets("2026-09-24", "2026-10-06", "week")).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(buckets("2026-01-15", "2026-03-02", "month")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(bucketKey("2026-09-29", "month")).toBe("2026-09");
    expect(gaBucketKey("20260929", "day")).toBe("2026-09-29");
    expect(gaBucketKey("202609", "month")).toBe("2026-09");
    expect(gaBucketKey("202640", "week")).toBe("2026-09-28"); // ISO week 40 of 2026 starts Mon 28 Sep
    expect(gaBucketKey("202101", "week")).toBe("2021-01-04");
  });
});

describe("filters", () => {
  it("reads single and repeated query values", () => {
    expect(parseFilters({ device: "mobile", payment: ["cod", "razorpay"], junk: "x", city: "" })).toEqual({ device: ["mobile"], payment: ["cod", "razorpay"] });
  });

  it("turns visitor filters into a GA4 filter; item filters only for item reports", () => {
    const f = parseFilters({ device: "mobile", product: "p1", payment: "cod" });
    expect(gaFilter(f, "event")).toEqual({ filter: { fieldName: "deviceCategory", inListFilter: { values: ["mobile"], caseSensitive: false } } });
    const item = gaFilter(f, "item", { product: new Map([["p1", "Bunny"]]) });
    const byField = new Map(item?.andGroup?.expressions.map((e) => [e.filter?.fieldName, e.filter?.inListFilter?.values]));
    expect([...byField.keys()].sort()).toEqual(["deviceCategory", "itemName"]);
    expect(byField.get("itemName")).toEqual(["Bunny"]);
    expect(gaFilter({}, "event")).toBeUndefined();
  });

  it("explains which filters can't apply", () => {
    const notes = filterNotes(parseFilters({ device: "mobile", payment: "cod", country: "India" }), { store: true, ga: true });
    expect(notes.some((n) => n.startsWith("Device filters the Google Analytics"))).toBe(true);
    expect(notes.some((n) => n.startsWith("Payment method filters the shop's own"))).toBe(true);
    expect(notes.some((n) => n.startsWith("Country"))).toBe(false); // applies to both
    expect(filterNotes(parseFilters({ payment: "cod" }), { store: false, ga: true })[0]).toMatch(/only Google Analytics/);
  });

  it("filters orders and counts only matching lines for product filters", () => {
    const orders = [
      { id: "1", payment_method: "cod", shipping_address: { state: "Maharashtra", city: "Pune" }, order_items: [{ product_id: "a" }, { product_id: "b" }] },
      { id: "2", payment_method: "razorpay", shipping_address: { state: "Kerala", city: "Kochi" }, order_items: [{ product_id: "b" }] },
    ];
    expect(filterOrders(orders, { payment: ["COD"] }).orders.map((o) => o.id)).toEqual(["1"]);
    expect(filterOrders(orders, { region: ["kerala"] }).orders.map((o) => o.id)).toEqual(["2"]);
    const byProduct = filterOrders(orders, { product: ["a"] });
    expect(byProduct.orders.map((o) => o.id)).toEqual(["1"]);
    expect(byProduct.lineMatch!({ product_id: "b" })).toBe(false);
    const byType = filterOrders(orders, { customerType: ["returning"] }, { returning: new Set(["x"]), keyOf: (o) => (o.id === "2" ? "x" : "y") });
    expect(byType.orders.map((o) => o.id)).toEqual(["2"]);
  });
});
