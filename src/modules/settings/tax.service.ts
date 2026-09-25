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

/* ============================================================
   Order-level GST (used by checkout and by tax invoices)
   ============================================================ */

export interface OrderGstLineInput {
  /** The line total as charged, before any order-level discount. */
  amount: number;
  ratePercent: number;
  hsn?: string | null;
}

export interface OrderGstChargeInput {
  label: string;
  amount: number;
}

export interface OrderGstComputed {
  label?: string;
  hsn: string | null;
  ratePercent: number;
  /** Value the tax is charged on — after this line's share of the discount. */
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  /** taxableValue + totalTax (the amount the customer pays for this line). */
  gross: number;
}

export interface OrderGstSummaryRow {
  hsn: string | null;
  ratePercent: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
}

export interface OrderGstResult {
  isInterState: boolean;
  lines: OrderGstComputed[];
  charges: OrderGstComputed[];
  /** Grouped by HSN + rate — the tax summary printed on a GST invoice. */
  summary: OrderGstSummaryRow[];
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  /** Everything the customer pays: taxable value + tax. */
  grandTotal: number;
}

const toPaise = (n: number) => Math.round(n * 100);
const fromPaise = (p: number) => p / 100;

/**
 * GST for a whole order, per CGST valuation rules:
 * - an order-level discount given at the time of supply reduces the taxable value, so it is
 *   apportioned across the lines in proportion to their value;
 * - shipping and gift wrap are part of one composite supply, so they're taxed at the rate
 *   (and shown under the HSN) of the principal supply — the highest-value line;
 * - with tax-inclusive prices the tax is carved out of the amount charged, so taxable value +
 *   tax always equals what the customer paid, to the paisa.
 * All arithmetic is in paise; CGST/SGST splits give any odd paisa to SGST so they re-add exactly.
 */
export function computeOrderGst(input: {
  lines: OrderGstLineInput[];
  discount: number;
  charges: OrderGstChargeInput[];
  sellerState: string;
  buyerState: string;
  pricesIncludeGst: boolean;
}): OrderGstResult {
  const isInterState = input.sellerState.trim().toLowerCase() !== input.buyerState.trim().toLowerCase();

  // Apportion the discount (largest-remainder free: last line takes the rounding remainder)
  const amounts = input.lines.map((l) => Math.max(0, toPaise(l.amount)));
  const base = amounts.reduce((a, b) => a + b, 0);
  const discount = Math.min(Math.max(0, toPaise(input.discount)), base);
  let allocated = 0;
  const nets = amounts.map((a, i) => {
    if (i === amounts.length - 1) return a - (discount - allocated);
    const share = base > 0 ? Math.round((discount * a) / base) : 0;
    allocated += share;
    return a - share;
  });

  const taxOne = (netPaise: number, rate: number): Omit<OrderGstComputed, "hsn" | "ratePercent" | "label"> => {
    let taxable: number;
    let tax: number;
    if (input.pricesIncludeGst) {
      taxable = Math.round(netPaise / (1 + rate / 100));
      tax = netPaise - taxable;
    } else {
      taxable = netPaise;
      tax = Math.round((netPaise * rate) / 100);
    }
    const cgst = isInterState ? 0 : Math.floor(tax / 2);
    const sgst = isInterState ? 0 : tax - cgst;
    const igst = isInterState ? tax : 0;
    return {
      taxableValue: fromPaise(taxable),
      cgst: fromPaise(cgst),
      sgst: fromPaise(sgst),
      igst: fromPaise(igst),
      totalTax: fromPaise(tax),
      gross: fromPaise(taxable + tax),
    };
  };

  const lines = input.lines.map((l, i) => ({ hsn: l.hsn ?? null, ratePercent: l.ratePercent, ...taxOne(nets[i], l.ratePercent) }));

  // Principal supply = the highest-value line after discount
  let principal = 0;
  nets.forEach((n, i) => {
    if (n > nets[principal]) principal = i;
  });
  const pRate = input.lines[principal]?.ratePercent ?? 0;
  const pHsn = input.lines[principal]?.hsn ?? null;
  const charges = input.charges
    .filter((c) => toPaise(c.amount) > 0)
    .map((c) => ({ label: c.label, hsn: pHsn, ratePercent: pRate, ...taxOne(toPaise(c.amount), pRate) }));

  const groups = new Map<string, OrderGstSummaryRow>();
  for (const row of [...lines, ...charges]) {
    const key = `${row.hsn ?? ""}|${row.ratePercent}`;
    const g = groups.get(key) ?? { hsn: row.hsn, ratePercent: row.ratePercent, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
    g.taxableValue += toPaise(row.taxableValue);
    g.cgst += toPaise(row.cgst);
    g.sgst += toPaise(row.sgst);
    g.igst += toPaise(row.igst);
    g.totalTax += toPaise(row.totalTax);
    groups.set(key, g);
  }
  const summary = [...groups.values()]
    .map((g) => ({ ...g, taxableValue: fromPaise(g.taxableValue), cgst: fromPaise(g.cgst), sgst: fromPaise(g.sgst), igst: fromPaise(g.igst), totalTax: fromPaise(g.totalTax) }))
    .sort((a, b) => b.ratePercent - a.ratePercent || String(a.hsn ?? "").localeCompare(String(b.hsn ?? "")));

  const sum = (k: "taxableValue" | "cgst" | "sgst" | "igst" | "totalTax" | "gross") =>
    fromPaise([...lines, ...charges].reduce((a, r) => a + toPaise(r[k]), 0));

  return {
    isInterState,
    lines,
    charges,
    summary,
    taxableValue: sum("taxableValue"),
    cgst: sum("cgst"),
    sgst: sum("sgst"),
    igst: sum("igst"),
    totalTax: sum("totalTax"),
    grandTotal: sum("gross"),
  };
}
