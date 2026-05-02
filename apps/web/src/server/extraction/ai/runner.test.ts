import { describe, expect, it } from 'vitest';
import type {
  ExtractedProduct,
  PlanField,
  PremiumRateField,
} from '../heuristic-to-envelope';
import { sanitisePlanRawCodes } from './runner';

// ─── Factories ─────────────────────────────────────────────────

function makePlan(rawCode: string, confidence = 0.8, schedule: Record<string, unknown> = {}): PlanField {
  return {
    rawCode,
    rawName: rawCode,
    code: rawCode,
    name: rawCode,
    coverBasis: 'per_cover_tier',
    stacksOnRawCode: null,
    stacksOnRawCodes: [],
    selectionMode: 'broker_default',
    schedule,
    confidence,
  };
}

function makeRate(planRawCode: string, confidence = 0.8): PremiumRateField {
  return {
    planRawCode,
    coverTier: null,
    ratePerThousand: 1.5,
    fixedAmount: null,
    ageBand: null,
    confidence,
  };
}

function makeProduct(
  plans: PlanField[],
  premiumRates: PremiumRateField[],
  categories: ExtractedProduct['eligibility']['categories'] = [],
): ExtractedProduct {
  return {
    productTypeCode: 'GTL',
    insurerCode: 'GE_LIFE',
    header: {
      policyNumber: { value: null, confidence: 0 },
      period: { value: null, confidence: 0 },
      lastEntryAge: { value: null, confidence: 0 },
      administrationType: { value: null, confidence: 0 },
      currency: { value: null, confidence: 0 },
    },
    policyholder: {
      legalName: { value: null, confidence: 0 },
      uen: { value: null, confidence: 0 },
      address: { value: null, confidence: 0 },
      businessDescription: { value: null, confidence: 0 },
      insuredEntities: [],
    },
    eligibility: { freeText: { value: null, confidence: 0 }, categories },
    plans,
    premiumRates,
    benefits: [],
    extractionMeta: { overallConfidence: 0.8, extractorVersion: 'test', warnings: [] },
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('sanitisePlanRawCodes', () => {
  describe('no-op cases', () => {
    it('returns product unchanged when plans array is empty', () => {
      const product = makeProduct([], []);
      const result = sanitisePlanRawCodes(product);
      expect(result).toBe(product);
    });

    it('leaves short codes unchanged', () => {
      const product = makeProduct(
        [makePlan('A'), makePlan('B'), makePlan('C')],
        [makeRate('A'), makeRate('B'), makeRate('C')],
      );
      const result = sanitisePlanRawCodes(product);
      const codes = result.plans.map((p) => p.rawCode).sort();
      expect(codes).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Phase 1 — "Plan X: description" prefix stripping', () => {
    it('extracts short code from "Plan A: Board of Directors"', () => {
      const product = makeProduct(
        [makePlan('Plan A: Board of Directors', 0.7)],
        [makeRate('Plan A: Board of Directors', 0.7)],
      );
      const result = sanitisePlanRawCodes(product);
      expect(result.plans).toHaveLength(1);
      expect(result.plans[0]?.rawCode).toBe('A');
      expect(result.premiumRates[0]?.planRawCode).toBe('A');
    });

    it('extracts numeric code from "Plan 1: Default"', () => {
      const product = makeProduct(
        [makePlan('Plan 1: Default', 0.7)],
        [makeRate('Plan 1: Default', 0.7)],
      );
      const result = sanitisePlanRawCodes(product);
      expect(result.plans[0]?.rawCode).toBe('1');
    });

    it('handles em-dash separator "Plan B — Senior Staff"', () => {
      const product = makeProduct(
        [makePlan('Plan B — Senior Staff', 0.7)],
        [makeRate('Plan B — Senior Staff', 0.7)],
      );
      const result = sanitisePlanRawCodes(product);
      expect(result.plans[0]?.rawCode).toBe('B');
    });
  });

  describe('Phase 1 — multi-line rawCode stripping', () => {
    it('reduces multi-line rawCode to first line', () => {
      const multiLine = 'A\nSome long footnote description';
      const product = makeProduct(
        [makePlan(multiLine, 0.7)],
        [makeRate(multiLine, 0.7)],
      );
      const result = sanitisePlanRawCodes(product);
      expect(result.plans[0]?.rawCode).toBe('A');
      expect(result.premiumRates[0]?.planRawCode).toBe('A');
    });

    it('trims whitespace from first line', () => {
      const multiLine = '  B  \nignored description';
      const product = makeProduct(
        [makePlan(multiLine, 0.7)],
        [makeRate(multiLine, 0.7)],
      );
      const result = sanitisePlanRawCodes(product);
      expect(result.plans[0]?.rawCode).toBe('B');
    });
  });

  describe('Phase 3 — deduplication by canonical code', () => {
    it('dedupes long-form and short-code versions of the same plan', () => {
      const longForm = makePlan('Plan A: Board of Directors', 0.6);
      const shortCode = makePlan('A', 0.9, { benefit: 'death' });
      const product = makeProduct(
        [longForm, shortCode],
        [makeRate('Plan A: Board of Directors', 0.6), makeRate('A', 0.9)],
      );
      const result = sanitisePlanRawCodes(product);
      expect(result.plans).toHaveLength(1);
      expect(result.plans[0]?.rawCode).toBe('A');
    });

    it('keeps the higher-confidence plan when deduplicating', () => {
      const longForm = makePlan('Plan A: All Others', 0.5);
      const shortCode = makePlan('A', 0.9);
      const product = makeProduct([longForm, shortCode], []);
      const result = sanitisePlanRawCodes(product);
      expect(result.plans[0]?.confidence).toBe(0.9);
    });

    it('keeps the plan with more schedule depth when confidence is equal', () => {
      const longForm = makePlan('Plan A: Description', 0.8);
      const withSchedule = makePlan('A', 0.8, { si: '5×salary', cover: 'death' });
      const product = makeProduct([longForm, withSchedule], []);
      const result = sanitisePlanRawCodes(product);
      expect(Object.keys(result.plans[0]?.schedule ?? {})).toHaveLength(2);
    });

    it('produces distinct canonical codes for different plans', () => {
      const plans = [
        makePlan('Plan A: Board of Directors', 0.6),
        makePlan('A', 0.9),
        makePlan('Plan B: All Others', 0.6),
        makePlan('B', 0.9),
      ];
      const product = makeProduct(plans, []);
      const result = sanitisePlanRawCodes(product);
      const codes = result.plans.map((p) => p.rawCode).sort();
      expect(codes).toEqual(['A', 'B']);
    });
  });

  describe('Phase 4 — premium rate remapping', () => {
    it('remaps rate planRawCode to canonical short code', () => {
      const product = makeProduct(
        [makePlan('Plan A: Description', 0.7)],
        [makeRate('Plan A: Description', 0.7)],
      );
      const result = sanitisePlanRawCodes(product);
      expect(result.premiumRates[0]?.planRawCode).toBe('A');
    });

    it('deduplicates rates with same canonical key (planRawCode::coverTier::blockLabel)', () => {
      // Both plans must be present so codeMap maps the long form → 'A'
      const product = makeProduct(
        [makePlan('Plan A: Description', 0.6), makePlan('A', 0.9)],
        [
          makeRate('Plan A: Description', 0.6),
          makeRate('A', 0.9),
        ],
      );
      const result = sanitisePlanRawCodes(product);
      // Both resolve to key "A::_::_" — only the higher confidence survives
      expect(result.premiumRates).toHaveLength(1);
      expect(result.premiumRates[0]?.confidence).toBe(0.9);
    });

    it('drops rates whose plan rawCode resolves to empty string (unmapped long code)', () => {
      // A product with only long-form plans and no categories → no mapping possible
      const product = makeProduct(
        [makePlan('A', 0.9)],
        [
          makeRate('A', 0.9),
          makeRate('Board of Directors who are in the executive category', 0.5),
        ],
        // No categories provided — unmapped long code gets dropped
      );
      // Add an extra plan with a very long rawCode that won't map
      product.plans.push(
        makePlan('Board of Directors who are in the executive category', 0.5),
      );
      const result = sanitisePlanRawCodes(product);
      // The unmapped plan and its rate should be dropped
      const planCodes = result.plans.map((p) => p.rawCode);
      expect(planCodes).not.toContain('Board of Directors who are in the executive category');
    });

    it('preserves rates for plans that were already short codes', () => {
      const product = makeProduct(
        [makePlan('A'), makePlan('B')],
        [makeRate('A'), makeRate('B')],
      );
      const result = sanitisePlanRawCodes(product);
      const rateCodes = result.premiumRates.map((r) => r.planRawCode).sort();
      expect(rateCodes).toEqual(['A', 'B']);
    });
  });

  describe('Phase 2 — category label matching for long codes', () => {
    it('maps long descriptive code to canonical via category defaultPlanRawCode', () => {
      const longCode = 'Board of Directors and Senior Management';
      const categories = [
        {
          category: 'Board of Directors and Senior Management',
          headcount: null,
          sumInsuredFormula: null,
          participation: null,
          defaultPlanRawCode: 'A',
          confidence: 1.0,
        },
      ];
      const product = makeProduct(
        [makePlan('A', 0.9), makePlan(longCode, 0.5)],
        [makeRate('A', 0.9), makeRate(longCode, 0.5)],
        categories,
      );
      const result = sanitisePlanRawCodes(product);
      // The long code should collapse onto 'A'
      const planCodes = result.plans.map((p) => p.rawCode);
      expect(planCodes).toEqual(['A']);
      const rateCodes = result.premiumRates.map((r) => r.planRawCode);
      expect(rateCodes).toEqual(['A']);
    });
  });
});
