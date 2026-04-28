// =============================================================
// per_individual_fixed_sum strategy — GTL (CUBER senior), GCI, GPA.
//
// sum_assured comes from plan.schedule.sumAssured (fixed per plan).
// premium = sum_assured / 1000 × ratePerThousand × headcount
// =============================================================

import type { EstimateInput, EstimateOutput, PremiumStrategy, ValidationIssue } from './types';

export const perIndividualFixedSum: PremiumStrategy = {
  code: 'per_individual_fixed_sum',

  validate(plans, rates): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const plan of plans) {
      const sched = plan.schedule as { sumAssured?: number };
      if (!sched.sumAssured || sched.sumAssured <= 0) {
        issues.push({
          severity: 'error',
          message: `Plan ${plan.code} is missing schedule.sumAssured.`,
        });
      }
      const r = rates.find((r) => r.planId === plan.id);
      if (!r || (r.ratePerThousand ?? 0) === 0) {
        issues.push({
          severity: 'warning',
          message: `Plan ${plan.code} has no ratePerThousand.`,
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
      const sumAssured = (plan.schedule as { sumAssured?: number }).sumAssured ?? 0;
      const rate = rates.find((r) => r.planId === plan.id);
      const ratePerThousand = rate?.ratePerThousand ?? 0;
      const perPerson = (sumAssured / 1000) * ratePerThousand;
      const premium = perPerson * hc.headcount;
      total += premium;
      lines.push({
        planId: plan.id,
        groupId: null,
        coverTier: null,
        headcount: hc.headcount,
        rate: ratePerThousand,
        premium,
        note: `sum_assured=${sumAssured.toFixed(0)}`,
      });
    }
    return { total, lines, warnings: [] };
  },
};
