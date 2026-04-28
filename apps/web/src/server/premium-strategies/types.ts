// =============================================================
// Premium strategy interface (S24 — v2 plan §4).
//
// Five strategies cover everything in the three placement slips:
//   per_individual_salary_multiple — GTL (CUBER corp, STM all), GDI
//   per_individual_fixed_sum       — GTL (CUBER senior), GCI, GPA
//   per_group_cover_tier           — GHS, GMM, Dental, SP, GP, FWM
//   per_headcount_flat             — GBT
//   per_individual_earnings        — WICI
//
// Strategies are *code* (math), not catalogue data — adding a new
// one is a code change. Each module exports a default object that
// implements the PremiumStrategy interface below.
// =============================================================

import type { PremiumStrategy as PremiumStrategyCode } from '@insurance-saas/shared-types';

export type Money = number; // express in cents to avoid float drift? For Phase 1 we keep dollars.

// Plan as the strategies see it — schedule is opaque JSONB the
// strategy reads as it pleases (e.g. WICI reads earningsBands).
export type StrategyPlan = {
  id: string;
  code: string;
  name: string;
  coverBasis: string;
  stacksOn: string | null;
  selectionMode: string;
  schedule: Record<string, unknown>;
  effectiveFrom: Date | string | null;
  effectiveTo: Date | string | null;
};

// PremiumRate as the strategies see it.
export type StrategyRate = {
  id?: string;
  planId: string;
  groupId: string | null;
  coverTier: string | null;
  ratePerThousand: number | null;
  fixedAmount: number | null;
};

// Per-(group, tier) headcount estimate, used by per_group_cover_tier.
export type GroupTierHeadcount = {
  groupId: string;
  coverTier: string;
  headcount: number;
};

// Per-plan headcount estimate, used by all other strategies.
// Optional fields use `?: T | undefined` so Zod's inferred shape
// (which includes `| undefined` for `.optional()` fields) is
// assignable under `exactOptionalPropertyTypes: true`.
export type PlanHeadcount = {
  planId: string;
  headcount: number;
  averageSalary?: number | undefined;
  averageAnnualEarnings?: number | undefined;
};

export type EstimateInput = {
  plans: StrategyPlan[];
  rates: StrategyRate[];
  // Either or both, depending on strategy. `?: T | undefined` matches
  // the Zod-inferred shape under `exactOptionalPropertyTypes: true`.
  groupTierHeadcount?: GroupTierHeadcount[] | undefined;
  planHeadcount?: PlanHeadcount[] | undefined;
};

export type LineItem = {
  planId: string;
  groupId: string | null;
  coverTier: string | null;
  headcount: number;
  rate: number;
  premium: Money;
  note?: string;
};

export type EstimateOutput = {
  total: Money;
  lines: LineItem[];
  warnings: string[];
};

export type ValidationIssue = {
  severity: 'error' | 'warning';
  message: string;
};

export type PremiumStrategy = {
  code: PremiumStrategyCode;
  // Returns issues blocking premium calc (missing rates, etc.).
  validate(plans: StrategyPlan[], rates: StrategyRate[]): ValidationIssue[];
  // Live preview computation. Returns 0 when inputs are empty.
  estimate(input: EstimateInput): EstimateOutput;
};
