// Maps ProductType.premiumStrategy → the per-Plan coverBasis it
// implies. Shared between the wizard-time extractor and the apply-
// time placement-slips router so the two can't drift.

export type CoverBasis = 'per_cover_tier' | 'salary_multiple' | 'fixed_amount' | 'per_region';

export const COVER_BASIS_BY_STRATEGY: Record<string, CoverBasis> = {
  per_individual_salary_multiple: 'salary_multiple',
  per_individual_fixed_sum: 'fixed_amount',
  per_group_cover_tier: 'per_cover_tier',
  per_headcount_flat: 'fixed_amount',
  per_individual_earnings: 'fixed_amount',
};

// Excel column letter → 1-based numeric index.
//   "A" → 1, "B" → 2, ...
// Single-letter only — sufficient for the rate columns the parser
// reads. Two-letter columns aren't used by any seeded template.
export function excelColumnIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 64;
}
