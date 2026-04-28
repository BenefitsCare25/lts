// =============================================================
// Strategy registry — looks up the right module by ProductType.premiumStrategy.
// =============================================================

import type { PremiumStrategy as PremiumStrategyCode } from '@insurance-saas/shared-types';
import { perGroupCoverTier } from './per-group-cover-tier';
import { perHeadcountFlat } from './per-headcount-flat';
import { perIndividualEarnings } from './per-individual-earnings';
import { perIndividualFixedSum } from './per-individual-fixed-sum';
import { perIndividualSalaryMultiple } from './per-individual-salary-multiple';
import type { PremiumStrategy } from './types';

const REGISTRY: Record<PremiumStrategyCode, PremiumStrategy> = {
  per_individual_salary_multiple: perIndividualSalaryMultiple,
  per_individual_fixed_sum: perIndividualFixedSum,
  per_group_cover_tier: perGroupCoverTier,
  per_headcount_flat: perHeadcountFlat,
  per_individual_earnings: perIndividualEarnings,
};

export function getStrategy(code: string): PremiumStrategy | null {
  return REGISTRY[code as PremiumStrategyCode] ?? null;
}

export type * from './types';
