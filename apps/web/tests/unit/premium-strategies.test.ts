// =============================================================
// Unit tests for the premium strategy library (S24).
//
// AC anchor (per v2 plan §8 S24): CUBER GHS computes 1×$1260 (Senior
// EF) + 4×$172 (Corp EO) = $1,948 within ±$1.
// =============================================================

import { perGroupCoverTier } from '@/server/premium-strategies/per-group-cover-tier';
import { perHeadcountFlat } from '@/server/premium-strategies/per-headcount-flat';
import { perIndividualFixedSum } from '@/server/premium-strategies/per-individual-fixed-sum';
import { perIndividualSalaryMultiple } from '@/server/premium-strategies/per-individual-salary-multiple';
import type { StrategyPlan, StrategyRate } from '@/server/premium-strategies/types';
import { describe, expect, it } from 'vitest';

const ghsPlan: StrategyPlan = {
  id: 'plan_1',
  code: 'P1',
  name: 'Plan 1',
  coverBasis: 'per_cover_tier',
  stacksOn: null,
  selectionMode: 'broker_default',
  schedule: { dailyRoomBoard: 200 },
  effectiveFrom: null,
  effectiveTo: null,
};

describe('per_group_cover_tier — CUBER GHS AC', () => {
  it('computes 1×$1260 (Senior EF) + 4×$172 (Corp EO) = $1,948 within ±$1', () => {
    const rates: StrategyRate[] = [
      {
        planId: 'plan_1',
        groupId: 'senior',
        coverTier: 'EF',
        ratePerThousand: null,
        fixedAmount: 1260,
      },
      {
        planId: 'plan_1',
        groupId: 'corp',
        coverTier: 'EO',
        ratePerThousand: null,
        fixedAmount: 172,
      },
    ];
    const out = perGroupCoverTier.estimate({
      plans: [ghsPlan],
      rates,
      groupTierHeadcount: [
        { groupId: 'senior', coverTier: 'EF', headcount: 1 },
        { groupId: 'corp', coverTier: 'EO', headcount: 4 },
      ],
    });
    expect(out.total).toBeCloseTo(1948, 0);
    expect(out.lines).toHaveLength(2);
  });

  it('returns 0 when no rates are entered', () => {
    const out = perGroupCoverTier.estimate({
      plans: [ghsPlan],
      rates: [],
      groupTierHeadcount: [{ groupId: 'senior', coverTier: 'EF', headcount: 5 }],
    });
    expect(out.total).toBe(0);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('skips zero-headcount cells silently', () => {
    const out = perGroupCoverTier.estimate({
      plans: [ghsPlan],
      rates: [
        {
          planId: 'plan_1',
          groupId: 'senior',
          coverTier: 'EF',
          ratePerThousand: null,
          fixedAmount: 1260,
        },
      ],
      groupTierHeadcount: [
        { groupId: 'senior', coverTier: 'EF', headcount: 0 },
        { groupId: 'corp', coverTier: 'EO', headcount: 0 },
      ],
    });
    expect(out.total).toBe(0);
    expect(out.lines).toHaveLength(0);
  });
});

describe('per_individual_salary_multiple', () => {
  it('caps sum_assured at maxSumAssured', () => {
    const plan: StrategyPlan = {
      ...ghsPlan,
      schedule: { multiplier: 36, minSumAssured: 50_000, maxSumAssured: 500_000 },
    };
    const rates: StrategyRate[] = [
      { planId: 'plan_1', groupId: null, coverTier: null, ratePerThousand: 1.5, fixedAmount: null },
    ];
    const out = perIndividualSalaryMultiple.estimate({
      plans: [plan],
      rates,
      planHeadcount: [{ planId: 'plan_1', headcount: 10, averageSalary: 20_000 }],
    });
    // sum_assured = min(20000 * 36, 500000) = 500000
    // per person = 500000/1000 * 1.5 = 750
    // total = 750 * 10 = 7500
    expect(out.total).toBeCloseTo(7500, 0);
  });
});

describe('per_individual_fixed_sum', () => {
  it('uses plan.schedule.sumAssured', () => {
    const plan: StrategyPlan = {
      ...ghsPlan,
      schedule: { sumAssured: 100_000 },
    };
    const rates: StrategyRate[] = [
      { planId: 'plan_1', groupId: null, coverTier: null, ratePerThousand: 2, fixedAmount: null },
    ];
    const out = perIndividualFixedSum.estimate({
      plans: [plan],
      rates,
      planHeadcount: [{ planId: 'plan_1', headcount: 5 }],
    });
    // 100000/1000 * 2 = 200; * 5 = 1000
    expect(out.total).toBeCloseTo(1000, 0);
  });
});

describe('per_headcount_flat', () => {
  it('multiplies headcount by fixed amount', () => {
    const rates: StrategyRate[] = [
      { planId: 'plan_1', groupId: null, coverTier: null, ratePerThousand: null, fixedAmount: 25 },
    ];
    const out = perHeadcountFlat.estimate({
      plans: [ghsPlan],
      rates,
      planHeadcount: [{ planId: 'plan_1', headcount: 12 }],
    });
    expect(out.total).toBe(300);
  });
});

describe('S25 — effective-dated plans', () => {
  // Strategies don't filter dates themselves; the estimate router
  // does, then passes the surviving plans in. We sanity-check that
  // strategies happily ignore plans not in their input list.
  it('strategy uses only plans the caller passed in', () => {
    const newPlan: StrategyPlan = {
      ...ghsPlan,
      id: 'plan_new',
      effectiveFrom: new Date('2026-01-01'),
    };
    const rates: StrategyRate[] = [
      {
        planId: 'plan_old',
        groupId: 'g1',
        coverTier: 'EO',
        ratePerThousand: null,
        fixedAmount: 100,
      },
      {
        planId: 'plan_new',
        groupId: 'g1',
        coverTier: 'EO',
        ratePerThousand: null,
        fixedAmount: 200,
      },
    ];
    const out = perGroupCoverTier.estimate({
      plans: [newPlan],
      rates,
      groupTierHeadcount: [{ groupId: 'g1', coverTier: 'EO', headcount: 10 }],
    });
    expect(out.total).toBe(2000); // only plan_new × 10 × 200
  });
});
