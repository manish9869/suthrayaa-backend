// GST calculation, kept as a dedicated service per the plan's "site settings configures,
// dedicated services calculate" rule — this never touches the settings controller directly.

export interface GstBreakdown {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  /** taxableValue + totalTax — equals the input amount when prices are tax-inclusive. */
  totalWithTax: number;
  isInterState: boolean;
}

export interface ComputeGstInput {
  /** The price as charged today (tax-inclusive) or the pre-tax amount (tax-exclusive) —
   * distinguished by `pricesIncludeGst`. */
  amount: number;
  ratePercent: number;
  /** The registered business's GST state — always from settings, never hardcoded. */
  sellerState: string;
  /** The order's shipping-destination state. */
  buyerState: string;
  pricesIncludeGst: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Intra-state (seller and buyer in the same state) splits the rate evenly into CGST+SGST;
 * inter-state charges the full rate as IGST. Determined purely by comparing the two state
 * names — no state is ever special-cased in code.
 */
export function computeGst(input: ComputeGstInput): GstBreakdown {
  const { amount, ratePercent, sellerState, buyerState, pricesIncludeGst } = input;
  const isInterState = sellerState.trim().toLowerCase() !== buyerState.trim().toLowerCase();

  const taxableValue = pricesIncludeGst ? amount / (1 + ratePercent / 100) : amount;
  const totalTax = taxableValue * (ratePercent / 100);

  const cgst = isInterState ? 0 : totalTax / 2;
  const sgst = isInterState ? 0 : totalTax / 2;
  const igst = isInterState ? totalTax : 0;

  return {
    taxableValue: round2(taxableValue),
    cgst: round2(cgst),
    sgst: round2(sgst),
    igst: round2(igst),
    totalTax: round2(totalTax),
    totalWithTax: round2(taxableValue + totalTax),
    isInterState,
  };
}
