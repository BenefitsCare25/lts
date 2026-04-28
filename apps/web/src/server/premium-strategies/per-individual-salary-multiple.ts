// =============================================================
// per_individual_salary_multiple strategy — GTL (CUBER corp, STM all), GDI.
//
// sum_assured = avg_salary × multiplier (bounded by min/max)
// premium     = sum_assured / 1000 × ratePerThousand × headcount
// =============================================================

import type { EstimateInput, EstimateOutput, PremiumStrategy, ValidationIssue } from './types';

export const perIndividualSalaryMultiple: PremiumStrategy = {
  code: 'per_individual_salary_multiple',

  validate(plans, rates): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const plan of plans) {
      const sched = plan.schedule;
      if (!sched.multiplier) {
        issues.push({
          severity: 'error',
          message: `Plan ${plan.code} is missing schedule.multiplier.`,
        });
      }
      const planRates = rates.filter((r) => r.planId === plan.id);
      if (!planRates.some((r) => (r.ratePerThousand ?? 0) > 0)) {
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
    const warnings: string[] = [];
    let total = 0;

    for (const plan of plans) {
      const hc = planHeadcount.find((p) => p.planId === plan.id);
      if (!hc || hc.headcount <= 0 || !hc.averageSalary) continue;

      const sched = plan.schedule as {
        multiplier?: number;
        minSumAssured?: number;
        maxSumAssured?: number;
      };
      const multiplier = sched.multiplier ?? 0;
      const min = sched.minSumAssured ?? 0;
      const max = sched.maxSumAssured ?? Number.POSITIVE_INFINITY;
      const rawSumAssured = hc.averageSalary * multiplier;
      const sumAssured = Math.min(Math.max(rawSumAssured, min), max);

      // Pick the first rate row for the plan (no group / tier dimension).
      const rate = rates.find((r) => r.planId === plan.id);
      const ratePerThousand = rate?.ratePerThousand ?? 0;
      if (ratePerThousand === 0) {
        warnings.push(`No ratePerThousand for ${plan.code} — counted as 0.`);
      }
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
    return { total, lines, warnings };
  },
};
