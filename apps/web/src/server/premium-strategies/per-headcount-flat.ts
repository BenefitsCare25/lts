// =============================================================
// per_headcount_flat strategy — GBT (uniform).
//
// premium = headcount × fixedAmount (per plan).
// =============================================================

import type { EstimateInput, EstimateOutput, PremiumStrategy, ValidationIssue } from './types';

export const perHeadcountFlat: PremiumStrategy = {
  code: 'per_headcount_flat',

  validate(plans, rates): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const plan of plans) {
      const r = rates.find((r) => r.planId === plan.id);
      if (!r || (r.fixedAmount ?? 0) === 0) {
        issues.push({
          severity: 'warning',
          message: `Plan ${plan.code} has no fixed amount per member.`,
        });
      }
    }
    return issues;
  },

  estimate(input: EstimateInput): EstimateOutput {
    const { plans, rates, planHeadcount = [] } = input;
    const lines = [] as EstimateOutput['lines'];
    let total = 0;
    for (const plan of plans) {
      const hc = planHeadcount.find((p) => p.planId === plan.id);
      if (!hc || hc.headcount <= 0) continue;
      const rate = rates.find((r) => r.planId === plan.id);
      const fixedAmount = rate?.fixedAmount ?? 0;
      const premium = hc.headcount * fixedAmount;
      total += premium;
      lines.push({
        planId: plan.id,
        groupId: null,
        coverTier: null,
        headcount: hc.headcount,
        rate: fixedAmount,
        premium,
      });
    }
    return { total, lines, warnings: [] };
  },
};
