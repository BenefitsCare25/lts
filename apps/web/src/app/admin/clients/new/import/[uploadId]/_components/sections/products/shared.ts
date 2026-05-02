// Shared constants, types, and helpers used by 2+ tab files
// within the products section.

import type { WizardExtractedProduct, WizardPlanField } from '../_types';

// Re-export ProductPatcher so each tab file imports from one place
export type ProductPatcher = (
  patch: (p: WizardExtractedProduct) => WizardExtractedProduct,
) => void;

export const COVER_BASIS_OPTIONS: WizardPlanField['coverBasis'][] = [
  'per_cover_tier',
  'salary_multiple',
  'fixed_amount',
  'per_region',
  'earnings_based',
  'per_employee_flat',
];

export const COVER_BASIS_LABELS: Record<WizardPlanField['coverBasis'], string> = {
  per_cover_tier: 'Per cover tier',
  salary_multiple: 'Salary multiple',
  fixed_amount: 'Fixed amount',
  per_region: 'Per region',
  earnings_based: 'Earnings based',
  per_employee_flat: 'Per employee (flat)',
};

export const COMMON_COVER_TIERS = ['EO', 'EF', 'E1C', 'E2C', 'E3C', 'E4C'];
