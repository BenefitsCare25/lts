import { describe, expect, it } from 'vitest';
import type { ExtractedProduct } from './heuristic-to-envelope';
import { reconcile } from './reconciliation';

// Minimal factory: only the fields reconcile() actually touches.
function makeProduct(
  productTypeCode: string,
  insurerCode: string,
  opts: {
    fixedAmounts?: number[];
    declaredPremium?: number | null;
  } = {},
): ExtractedProduct {
  const rates = (opts.fixedAmounts ?? []).map((amount, i) => ({
    planRawCode: `P${i + 1}`,
    coverTier: null,
    ratePerThousand: null,
    fixedAmount: amount,
    ageBand: null,
    confidence: 1.0,
  }));

  return {
    productTypeCode,
    insurerCode,
    header: {
      policyNumber: { value: null, confidence: 0 },
      period: { value: null, confidence: 0 },
      lastEntryAge: { value: null, confidence: 0 },
      administrationType: { value: null, confidence: 0 },
      currency: { value: null, confidence: 0 },
      ...(opts.declaredPremium != null
        ? { declaredPremium: { value: opts.declaredPremium, confidence: 1.0 } }
        : {}),
    },
    policyholder: {
      legalName: { value: null, confidence: 0 },
      uen: { value: null, confidence: 0 },
      address: { value: null, confidence: 0 },
      businessDescription: { value: null, confidence: 0 },
      insuredEntities: [],
    },
    eligibility: { freeText: { value: null, confidence: 0 }, categories: [] },
    plans: [],
    premiumRates: rates,
    benefits: [],
    extractionMeta: {
      overallConfidence: 0.5,
      extractorVersion: 'test',
      warnings: [],
    },
  };
}

describe('reconcile', () => {
  describe('single product', () => {
    it('computes sum of fixedAmount rates', () => {
      const product = makeProduct('GTL', 'GE_LIFE', {
        fixedAmounts: [1000, 2000, 500],
        declaredPremium: 4000,
      });
      const report = reconcile([product]);
      expect(report.perProduct[0]?.computed).toBe(3500);
    });

    it('calculates variancePct as (computed - declared) / declared * 100', () => {
      const product = makeProduct('GTL', 'GE_LIFE', {
        fixedAmounts: [1050],
        declaredPremium: 1000,
      });
      const report = reconcile([product]);
      expect(report.perProduct[0]?.variancePct).toBeCloseTo(5.0);
    });

    it('calculates negative variance when computed < declared', () => {
      const product = makeProduct('GHS', 'GE_LIFE', {
        fixedAmounts: [950],
        declaredPremium: 1000,
      });
      const report = reconcile([product]);
      expect(report.perProduct[0]?.variancePct).toBeCloseTo(-5.0);
    });

    it('returns null variancePct when declared premium is absent', () => {
      const product = makeProduct('GTL', 'GE_LIFE', {
        fixedAmounts: [1000],
        declaredPremium: null,
      });
      const report = reconcile([product]);
      expect(report.perProduct[0]?.variancePct).toBeNull();
      expect(report.perProduct[0]?.declared).toBeNull();
    });

    it('returns null variancePct when declaredPremium field is not set on header', () => {
      const product = makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [1000] });
      const report = reconcile([product]);
      expect(report.perProduct[0]?.variancePct).toBeNull();
    });

    it('returns null variancePct when computed is zero', () => {
      const product = makeProduct('GTL', 'GE_LIFE', {
        fixedAmounts: [],
        declaredPremium: 1000,
      });
      const report = reconcile([product]);
      expect(report.perProduct[0]?.variancePct).toBeNull();
    });

    it('returns null computed when product has no premium rates', () => {
      const product = makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [] });
      const report = reconcile([product]);
      expect(report.perProduct[0]?.computed).toBeNull();
    });

    it('ignores ratePerThousand entries (only fixedAmount counts)', () => {
      const product = makeProduct('GTL', 'GE_LIFE', {
        fixedAmounts: [500],
        declaredPremium: 1000,
      });
      // Manually add a rate that has only ratePerThousand (no fixedAmount)
      product.premiumRates.push({
        planRawCode: 'P2',
        coverTier: null,
        ratePerThousand: 3.5,
        fixedAmount: null,
        ageBand: null,
        confidence: 1.0,
      });
      const report = reconcile([product]);
      // Only the 500 fixedAmount is summed; ratePerThousand is skipped
      expect(report.perProduct[0]?.computed).toBe(500);
    });

    it('preserves productTypeCode and insurerCode on the line', () => {
      const product = makeProduct('GPA', 'CHUBB', { fixedAmounts: [100] });
      const report = reconcile([product]);
      expect(report.perProduct[0]?.productTypeCode).toBe('GPA');
      expect(report.perProduct[0]?.insurerCode).toBe('CHUBB');
    });
  });

  describe('multiple products', () => {
    it('returns one line per product', () => {
      const products = [
        makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [1000], declaredPremium: 1000 }),
        makeProduct('GHS', 'GE_LIFE', { fixedAmounts: [2000], declaredPremium: 2000 }),
      ];
      const report = reconcile(products);
      expect(report.perProduct).toHaveLength(2);
    });

    it('grand computed sums all per-product computed values', () => {
      const products = [
        makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [1000], declaredPremium: 900 }),
        makeProduct('GHS', 'GE_LIFE', { fixedAmounts: [2000], declaredPremium: 2100 }),
      ];
      const report = reconcile(products);
      expect(report.grandComputed).toBe(3000);
    });

    it('grand declared sums all declared premiums', () => {
      const products = [
        makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [1000], declaredPremium: 900 }),
        makeProduct('GHS', 'GE_LIFE', { fixedAmounts: [2000], declaredPremium: 2100 }),
      ];
      const report = reconcile(products);
      expect(report.grandDeclared).toBe(3000);
    });

    it('grand variance is null when all declared premiums are absent', () => {
      const products = [
        makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [1000] }),
        makeProduct('GHS', 'GE_LIFE', { fixedAmounts: [2000] }),
      ];
      const report = reconcile(products);
      expect(report.grandDeclared).toBeNull();
      expect(report.grandVariancePct).toBeNull();
    });

    it('grand declared is non-null when at least one product has declared premium', () => {
      const products = [
        makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [1000], declaredPremium: 900 }),
        makeProduct('GHS', 'GE_LIFE', { fixedAmounts: [2000] }), // no declared
      ];
      const report = reconcile(products);
      // null declared for product 2 contributes 0, so grandDeclared = 900
      expect(report.grandDeclared).toBe(900);
    });

    it('computes grand variancePct correctly across mixed products', () => {
      const products = [
        makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [1100], declaredPremium: 1000 }),
        makeProduct('GHS', 'GE_LIFE', { fixedAmounts: [2200], declaredPremium: 2000 }),
      ];
      const report = reconcile(products);
      // grandComputed=3300, grandDeclared=3000, variance=10%
      expect(report.grandVariancePct).toBeCloseTo(10.0);
    });

    it('products with different variance signs are independent', () => {
      const products = [
        makeProduct('GTL', 'GE_LIFE', { fixedAmounts: [1100], declaredPremium: 1000 }),
        makeProduct('GHS', 'ZURICH', { fixedAmounts: [900], declaredPremium: 1000 }),
      ];
      const report = reconcile(products);
      const gtl = report.perProduct.find((l) => l.productTypeCode === 'GTL');
      const ghs = report.perProduct.find((l) => l.productTypeCode === 'GHS');
      expect(gtl?.variancePct).toBeCloseTo(10.0);
      expect(ghs?.variancePct).toBeCloseTo(-10.0);
    });
  });

  describe('empty input', () => {
    it('returns empty perProduct and zero grandComputed for empty array', () => {
      const report = reconcile([]);
      expect(report.perProduct).toHaveLength(0);
      expect(report.grandComputed).toBe(0);
      expect(report.grandDeclared).toBeNull();
      expect(report.grandVariancePct).toBeNull();
    });
  });
});
