/** RFC 4180 quoting, plus a leading apostrophe on text a spreadsheet would run as a formula. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type CsvColumn<T> = [header: string, value: (row: T) => unknown];

/** A CSV document with a BOM, so Excel opens ₹ and non-Latin names correctly. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map(([h]) => csvCell(h)).join(","), ...rows.map((row) => columns.map(([, get]) => csvCell(get(row))).join(","))];
  return "﻿" + lines.join("\r\n");
}

/**
 * Words from a free-text search, safe to embed in a PostgREST `or=` filter (whose syntax uses
 * commas, dots, parentheses and colons). Each word must match somewhere; at most 5 words.
 */
export function searchTokens(q: unknown): string[] {
  if (typeof q !== "string") return [];
  return q
    .replace(/[^\p{L}\p{N}@+\-_ ]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 5)
    .map((t) => t.slice(0, 60));
}
