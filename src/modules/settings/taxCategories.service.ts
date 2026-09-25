import { supabaseAdmin } from "../../config/supabase.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TaxCategoryInfo {
  rate: number;
  hsn: string | null;
}
let taxCategoryCache: { at: number; map: Map<string, TaxCategoryInfo> } | null = null;
/** GST rate + HSN code per tax category (cached for a minute so admin edits apply quickly). */
export async function getTaxCategories(): Promise<Map<string, TaxCategoryInfo>> {
  if (taxCategoryCache && Date.now() - taxCategoryCache.at < 60_000) return taxCategoryCache.map;
  const { data } = await supabaseAdmin.from("tax_categories").select("*");
  const map = new Map<string, TaxCategoryInfo>(
    (data ?? []).map((r: any) => [r.id, { rate: Number(r.rate), hsn: (r.hsn_code ?? "").trim() || null }])
  );
  taxCategoryCache = { at: Date.now(), map };
  return map;
}
