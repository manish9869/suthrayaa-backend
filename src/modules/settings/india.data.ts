// Single source of truth for India-specific static data + validators. Mirrored on the
// frontend as suthrayaa/lib/india.ts — keep both lists/regexes in sync.

export interface IndiaStateEntry {
  name: string;
  code: string;
  isUnionTerritory: boolean;
}

// State codes are the first two digits of a GSTIN issued in that state (per CBIC's GST
// state code list) — used by tax.service.ts to render the state code on GST invoices.
export const INDIA_STATES: IndiaStateEntry[] = [
  { name: "Andhra Pradesh", code: "37", isUnionTerritory: false },
  { name: "Arunachal Pradesh", code: "12", isUnionTerritory: false },
  { name: "Assam", code: "18", isUnionTerritory: false },
  { name: "Bihar", code: "10", isUnionTerritory: false },
  { name: "Chhattisgarh", code: "22", isUnionTerritory: false },
  { name: "Goa", code: "30", isUnionTerritory: false },
  { name: "Gujarat", code: "24", isUnionTerritory: false },
  { name: "Haryana", code: "06", isUnionTerritory: false },
  { name: "Himachal Pradesh", code: "02", isUnionTerritory: false },
  { name: "Jharkhand", code: "20", isUnionTerritory: false },
  { name: "Karnataka", code: "29", isUnionTerritory: false },
  { name: "Kerala", code: "32", isUnionTerritory: false },
  { name: "Madhya Pradesh", code: "23", isUnionTerritory: false },
  { name: "Maharashtra", code: "27", isUnionTerritory: false },
  { name: "Manipur", code: "14", isUnionTerritory: false },
  { name: "Meghalaya", code: "17", isUnionTerritory: false },
  { name: "Mizoram", code: "15", isUnionTerritory: false },
  { name: "Nagaland", code: "13", isUnionTerritory: false },
  { name: "Odisha", code: "21", isUnionTerritory: false },
  { name: "Punjab", code: "03", isUnionTerritory: false },
  { name: "Rajasthan", code: "08", isUnionTerritory: false },
  { name: "Sikkim", code: "11", isUnionTerritory: false },
  { name: "Tamil Nadu", code: "33", isUnionTerritory: false },
  { name: "Telangana", code: "36", isUnionTerritory: false },
  { name: "Tripura", code: "16", isUnionTerritory: false },
  { name: "Uttar Pradesh", code: "09", isUnionTerritory: false },
  { name: "Uttarakhand", code: "05", isUnionTerritory: false },
  { name: "West Bengal", code: "19", isUnionTerritory: false },
  { name: "Andaman and Nicobar Islands", code: "35", isUnionTerritory: true },
  { name: "Chandigarh", code: "04", isUnionTerritory: true },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "26", isUnionTerritory: true },
  { name: "Delhi", code: "07", isUnionTerritory: true },
  { name: "Jammu and Kashmir", code: "01", isUnionTerritory: true },
  { name: "Ladakh", code: "38", isUnionTerritory: true },
  { name: "Lakshadweep", code: "31", isUnionTerritory: true },
  { name: "Puducherry", code: "34", isUnionTerritory: true },
];

const STATE_NAME_SET = new Set(INDIA_STATES.map((s) => s.name));
const STATE_CODE_BY_NAME = new Map(INDIA_STATES.map((s) => [s.name, s.code]));

export function isValidIndianState(name: string): boolean {
  return STATE_NAME_SET.has(name);
}

export function stateCodeFor(name: string): string | undefined {
  return STATE_CODE_BY_NAME.get(name);
}

/** Strips spaces/hyphens and a leading +91/91/0 so "+91 98765 43210", "091-98765-43210",
 * and "9876543210" all normalize to the same 10-digit number before validating. */
export function normalizeIndianMobile(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

// Indian mobile numbers: 10 digits, first digit 6-9.
export function isValidIndianMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizeIndianMobile(value));
}

// 6-digit PIN code, first digit 1-9 (no Indian PIN code starts with 0).
export function isValidIndianPincode(value: string): boolean {
  return /^[1-9]\d{5}$/.test(value.trim());
}

// Standard 15-character GSTIN: 2-digit state code, 10-char PAN, 1 entity code, 1 checksum
// letter 'Z' by convention, 1 checksum digit/letter.
export function isValidGstin(value: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(value.trim().toUpperCase());
}

// PAN embedded within a GSTIN (characters 3-12) — same regex a standalone PAN field uses.
export function isValidPan(value: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(value.trim().toUpperCase());
}
