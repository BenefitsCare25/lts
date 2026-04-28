// =============================================================
// per_group_cover_tier strategy — used by GHS, GMM, Dental, SP, GP, FWM.
//
// Per (plan, group, tier) cell carries a fixedAmount (rate per
// member). Premium = headcount × fixedAmount, summed over every
// (group, tier) pair the broker has provided headcount for.
//
// AC anchor: CUBER GHS computes 1×$1260 (Senior EF) + 4×$172 (Corp EO) = $1,948.
// =============================================================

import type {
  EstimateInput,
  EstimateOutput,
  PremiumStrategy,
  StrategyPlan,
  StrategyRate,
  ValidationIssue,
} from './types';

export const perGroupCoverTier: PremiumStrategy = {
  code: 'per_group_cover_tier',

  validate(plans, rates): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (plans.length === 0) {
      issues.push({ severity: 'warning', message: 'No plans configured.' });
      return issues;
    }
    // Build a (plan, group, tier) coverage map. Warn for cells
    // missing a fixed amount — premium for that cell will be 0.
    const rateLookup = new Set(
      rates
        .filter((r) => r.fixedAmount !== null && r.fixedAmount > 0)
        .map((r) => `${r.planId}|${r.groupId ?? ''}|${r.coverTier ?? ''}`),
    );
    if (rateLookup.size === 0) {
      issues.push({ severity: 'warning', message: 'No premium rates entered yet.' });
    }
    return issues;
  },

  estimate(input: EstimateInput): EstimateOutput {
    const { plans, rates, groupTierHeadcount = [] } = input;
    const lines = [] as EstimateOutput['lines'];
    const warnings: string[] = [];

    // Index rates by (planId, groupId, coverTier) for O(1) lookup.
    const rateMap = new Map<string, StrategyRate>();
    for (const r of rates) {
      rateMap.set(`${r.planId}|${r.groupId ?? ''}|${r.coverTier ?? ''}`, r);
    }

    let total = 0;
    for (const plan of plans) {
      for (const hc of groupTierHeadcount) {
        if (hc.headcount <= 0) continue;
        const key = `${plan.id}|${hc.groupId}|${hc.coverTier}`;
        const rate = rateMap.get(key);
        const fixedAmount = rate?.fixedAmount ?? 0;
        if (fixedAmount === 0) {
          warnings.push(
            `No rate for ${plan.code} · group ${hc.groupId} · ${hc.coverTier} (×${hc.headcount}) — counted as 0.`,
          );
        }
        const premium = hc.headcount * fixedAmount;
        total += premium;
        lines.push({
          planId: plan.id,
          groupId: hc.groupId,
          coverTier: hc.coverTier,
          headcount: hc.headcount,
          rate: fixedAmount,
          premium,
        });
      }
    }
    return { total, lines, warnings };
  },
};

// Re-export StrategyPlan + StrategyRate for tree-shake convenience.
export type { StrategyPlan, StrategyRate };
