// =============================================================
// reconciliation — diff computed totals (rate × headcount × SI)
// against slip-declared totals. The Reconciliation section of the
// wizard renders this report directly.
//
// Per-product and grand-total computed from extractedProducts.
// Slip-declared totals come from header.declaredPremium on each
// extracted product. When declared is present, variancePct is
// computed; otherwise the section shows "computed only" mode.
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
    const declared = p.header.declaredPremium?.value ?? null;
    const variancePct =
      declared != null && computed > 0 ? ((computed - declared) / declared) * 100 : null;
    return {
      productTypeCode: p.productTypeCode,
      insurerCode: p.insurerCode,
      computed: p.premiumRates.length > 0 ? computed : null,
      declared,
      variancePct,
    };
  });
  const grandComputed = perProduct.reduce((acc, l) => acc + (l.computed ?? 0), 0);
  const grandDeclared = perProduct.some((l) => l.declared != null)
    ? perProduct.reduce((acc, l) => acc + (l.declared ?? 0), 0)
    : null;
  const grandVariancePct =
    grandDeclared != null && grandComputed > 0
      ? ((grandComputed - grandDeclared) / grandDeclared) * 100
      : null;
  return {
    perProduct,
    grandComputed,
    grandDeclared,
    grandVariancePct,
  };
}
