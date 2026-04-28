// =============================================================
// per_individual_earnings strategy — WICI.
//
// Rates live on plan.schedule.earningsBands as
//   [{ minAnnualEarnings, maxAnnualEarnings, rate }, ...]
// premium = sum over headcount of (annual_earnings × rate_at_band)
//
// For preview, we accept an averageAnnualEarnings × headcount and
// place the average earnings into its band.
// =============================================================

import type { EstimateInput, EstimateOutput, PremiumStrategy, ValidationIssue } from './types';

type Band = { minAnnualEarnings: number; maxAnnualEarnings?: number; rate: number };

export const perIndividualEarnings: PremiumStrategy = {
  code: 'per_individual_earnings',

  validate(plans): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const plan of plans) {
      const bands = (plan.schedule as { earningsBands?: Band[] }).earningsBands;
      if (!bands || bands.length === 0) {
        issues.push({
          severity: 'error',
          message: `Plan ${plan.code} is missing schedule.earningsBands.`,
        });
      }
    }
    return issues;
  },

  estimate(input: EstimateInput): EstimateOutput {
    const { plans, planHeadcount = [] } = input;
    const lines = [] as EstimateOutput['lines'];
    let total = 0;
    for (const plan of plans) {
      const hc = planHeadcount.find((p) => p.planId === plan.id);
      if (!hc || hc.headcount <= 0 || !hc.averageAnnualEarnings) continue;
      const bands = (plan.schedule as { earningsBands?: Band[] }).earningsBands ?? [];
      const matching = bands.find(
        (b) =>
          hc.averageAnnualEarnings != null &&
          hc.averageAnnualEarnings >= b.minAnnualEarnings &&
          (b.maxAnnualEarnings == null || hc.averageAnnualEarnings <= b.maxAnnualEarnings),
      );
      if (!matching) continue;
      const perPerson = hc.averageAnnualEarnings * matching.rate;
      const premium = perPerson * hc.headcount;
      total += premium;
      lines.push({
        planId: plan.id,
        groupId: null,
        coverTier: null,
        headcount: hc.headcount,
        rate: matching.rate,
        premium,
        note: `avg_earnings=${hc.averageAnnualEarnings.toFixed(0)}`,
      });
    }
    return { total, lines, warnings: [] };
  },
};
