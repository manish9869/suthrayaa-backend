import { supabaseAdmin } from "../../config/supabase.js";
import { getSettingsMap } from "./settings.service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ShippingQuote {
  fee: number;
  freeShippingApplied: boolean;
  estimateDays: { min: number; max: number };
  zoneName: string;
  codAvailable: boolean;
}

async function findZone(state: string | undefined) {
  const { data: zones } = await supabaseAdmin.from("shipping_zones").select("*").eq("is_active", true).order("sort_order");
  const list = (zones ?? []) as any[];
  if (state) {
    const match = list.find((z) => (z.states ?? []).some((s: string) => s.toLowerCase() === state.toLowerCase()));
    if (match) return match;
  }
  // Catch-all zone (seeded as "Rest of India" with an empty states[]) — the first zone with
  // no states listed acts as the default for anywhere not explicitly zoned.
  return list.find((z) => !z.states || z.states.length === 0) ?? null;
}

/**
 * Computes shipping for a destination state + order subtotal + method. Replaces
 * checkout.service.ts's hardcoded SHIPPING_RATES/FREE_SHIPPING_THRESHOLD — see
 * settings.catalog.ts's shipping.* defaults for why the out-of-the-box numbers match
 * today's hardcoded values exactly.
 */
export async function getShippingQuote(
  state: string | undefined,
  subtotal: number,
  method: "standard" | "express" = "standard"
): Promise<ShippingQuote> {
  const settings = await getSettingsMap([
    "shipping.free_shipping_enabled",
    "shipping.free_shipping_threshold",
    "shipping.default_fee",
    "shipping.express_surcharge",
  ]);

  const zone = await findZone(state);
  const baseFee = zone ? Number(zone.shipping_fee) : Number(settings["shipping.default_fee"]);
  const threshold = zone?.free_shipping_threshold != null ? Number(zone.free_shipping_threshold) : Number(settings["shipping.free_shipping_threshold"]);
  const freeShippingEnabled = Boolean(settings["shipping.free_shipping_enabled"]);

  const freeShippingApplied = freeShippingEnabled && subtotal >= threshold;
  const surcharge = method === "express" ? Number(settings["shipping.express_surcharge"]) : 0;
  const fee = freeShippingApplied ? 0 : baseFee + surcharge;

  return {
    fee: Math.round(fee * 100) / 100,
    freeShippingApplied,
    estimateDays: { min: zone?.delivery_min_days ?? 4, max: zone?.delivery_max_days ?? 7 },
    zoneName: zone?.name ?? "Rest of India",
    codAvailable: zone?.cod_available ?? true,
  };
}
