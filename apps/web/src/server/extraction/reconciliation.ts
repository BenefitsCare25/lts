// =============================================================
// reconciliation — diff computed totals (rate × headcount × SI)
// against slip-declared totals. The Reconciliation section of the
// wizard renders this report directly.
//
// Today: per-product and grand-total computed from extractedProducts.
// Slip-declared totals come from the heuristic parser's billing-
// numbers sheet inspection — for the Phase-1 calibration that's
// not wired in, so declared = null and the section displays a
// "computed only" mode. Once the parser learns the billing block,
// the diff lights up automatically.
// =============================================================

import type { ExtractedProduct } from './heuristic-to-envelope';

export type ReconciliationLine = {
  productTypeCode: string;
  insurerCode: string;
  computed: number | null;
  declared: number | null;
  variancePct: number | null;
};

export type ReconciliationReport = {
  perProduct: ReconciliationLine[];
  grandComputed: number;
  grandDeclared: number | null;
  grandVariancePct: number | null;
};

// Compute = sum over plans of:
//   rate_per_thousand × estimated_si × something
// We don't have headcount or SI yet (broker fills in Plans tab),
// so the computed total is "rates exist for this many plans" — a
// presence check rather than a math check. When the Plans tab
// grows headcount × SI inputs the reconciliation upgrades.
export function reconcile(extractedProducts: ExtractedProduct[]): ReconciliationReport {
  const perProduct: ReconciliationLine[] = extractedProducts.map((p) => {
    let computed = 0;
    for (const r of p.premiumRates) {
      // Best-effort: rates with fixed amounts add directly; per-thousand
      // rates need an SI value the broker will supply post-apply. For now
      // we surface the rate count as a proxy.
      if (r.fixedAmount != null) computed += r.fixedAmount;
    }
    return {
      productTypeCode: p.productTypeCode,
      insurerCode: p.insurerCode,
      computed: p.premiumRates.length > 0 ? computed : null,
      declared: null, // wired up when billing-numbers parser lands
      variancePct: null,
    };
  });
  const grandComputed = perProduct.reduce((acc, l) => acc + (l.computed ?? 0), 0);
  return {
    perProduct,
    grandComputed,
    grandDeclared: null,
    grandVariancePct: null,
  };
}
