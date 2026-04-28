// =============================================================
// Premium rates router (S24 — Screen 5d).
//
// Stores PremiumRate rows per (product, plan, group?, coverTier?).
// listForProduct / setForProduct (bulk replace) plus an `estimate`
// endpoint that runs the strategy module against current rates +
// caller-provided headcount estimates.
// =============================================================

import { prisma } from '@/server/db/client';
import { getStrategy } from '@/server/premium-strategies';
import type { StrategyPlan, StrategyRate } from '@/server/premium-strategies/types';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, tenantProcedure } from '../init';

async function loadProductForPremium(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      benefitYear: { policy: { client: { tenantId } } },
    },
    select: {
      id: true,
      benefitYear: { select: { state: true, policy: { select: { id: true } } } },
      productType: { select: { code: true, premiumStrategy: true } },
    },
  });
  if (!product) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found.' });
  }
  return product;
}

// PremiumRate row → strategy view (plain numbers; Decimals come back
// from Prisma as objects with .toNumber()).
function rateRowToStrategy(r: {
  id: string;
  planId: string;
  groupId: string | null;
  coverTier: string | null;
  ratePerThousand: Prisma.Decimal | null;
  fixedAmount: Prisma.Decimal | null;
}): StrategyRate {
  return {
    id: r.id,
    planId: r.planId,
    groupId: r.groupId,
    coverTier: r.coverTier,
    ratePerThousand: r.ratePerThousand ? r.ratePerThousand.toNumber() : null,
    fixedAmount: r.fixedAmount ? r.fixedAmount.toNumber() : null,
  };
}

const rateInputSchema = z.object({
  planId: z.string().min(1),
  groupId: z.string().min(1).nullable(),
  coverTier: z.string().min(1).max(8).nullable(),
  ratePerThousand: z.number().nonnegative().nullable(),
  fixedAmount: z.number().nonnegative().nullable(),
});

// Strategy-aware preview input — takes either group/tier headcount
// rows (for per_group_cover_tier) or per-plan headcount rows (others).
const headcountSchema = z.object({
  // S25: filter plans by effective window. Plans with no effective
  // dates (effectiveFrom/effectiveTo both null) are always active.
  asOf: z.coerce.date().optional(),
  groupTierHeadcount: z
    .array(
      z.object({
        groupId: z.string().min(1),
        coverTier: z.string().min(1),
        headcount: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  planHeadcount: z
    .array(
      z.object({
        planId: z.string().min(1),
        headcount: z.number().int().nonnegative(),
        averageSalary: z.number().nonnegative().optional(),
        averageAnnualEarnings: z.number().nonnegative().optional(),
      }),
    )
    .optional(),
});

// Returns true when the plan is active on the given date.
// A plan with no effective dates is always active.
function planActiveOn(
  plan: { effectiveFrom: Date | null; effectiveTo: Date | null },
  asOf: Date,
): boolean {
  if (plan.effectiveFrom && asOf < plan.effectiveFrom) return false;
  if (plan.effectiveTo && asOf > plan.effectiveTo) return false;
  return true;
}

export const premiumRatesRouter = router({
  listForProduct: tenantProcedure
    .input(z.object({ productId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const product = await loadProductForPremium(ctx.tenantId, input.productId);
      const rates = await prisma.premiumRate.findMany({
        where: { productId: input.productId },
        select: {
          id: true,
          planId: true,
          groupId: true,
          coverTier: true,
          ratePerThousand: true,
          fixedAmount: true,
        },
      });
      return {
        benefitYearState: product.benefitYear.state,
        premiumStrategy: product.productType.premiumStrategy,
        rates: rates.map(rateRowToStrategy),
      };
    }),

  setForProduct: tenantProcedure
    .input(
      z.object({
        productId: z.string().min(1),
        rates: z.array(rateInputSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const product = await loadProductForPremium(ctx.tenantId, input.productId);
      if (product.benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Premium rates can only be edited on DRAFT benefit years.',
        });
      }

      // Sanity-check FKs: every planId must belong to the product;
      // every groupId (if set) to the policy.
      const policyId = product.benefitYear.policy.id;
      const planIds = Array.from(new Set(input.rates.map((r) => r.planId)));
      const groupIds = Array.from(
        new Set(input.rates.map((r) => r.groupId).filter((g): g is string => g !== null)),
      );
      const [validPlans, validGroups] = await Promise.all([
        prisma.plan.findMany({
          where: { productId: input.productId, id: { in: planIds } },
          select: { id: true },
        }),
        groupIds.length > 0
          ? prisma.benefitGroup.findMany({
              where: { policyId, id: { in: groupIds } },
              select: { id: true },
            })
          : Promise.resolve([]),
      ]);
      const planSet = new Set(validPlans.map((p) => p.id));
      const groupSet = new Set(validGroups.map((g) => g.id));
      for (const r of input.rates) {
        if (!planSet.has(r.planId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Plan ${r.planId} is not on this product.`,
          });
        }
        if (r.groupId && !groupSet.has(r.groupId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Benefit group ${r.groupId} is not on this policy.`,
          });
        }
      }

      // Bulk replace inside a transaction.
      await prisma.$transaction([
        prisma.premiumRate.deleteMany({ where: { productId: input.productId } }),
        prisma.premiumRate.createMany({
          data: input.rates.map((r) => ({
            productId: input.productId,
            planId: r.planId,
            groupId: r.groupId,
            coverTier: r.coverTier,
            ratePerThousand: r.ratePerThousand,
            fixedAmount: r.fixedAmount,
          })),
        }),
      ]);
      return { saved: input.rates.length };
    }),

  // Live computed preview from headcount estimates.
  // Inputs are not persisted — they're broker-supplied estimates
  // for dry-run quoting. Real headcount comes from Employee data later.
  estimate: tenantProcedure
    .input(z.object({ productId: z.string().min(1) }).and(headcountSchema))
    .query(async ({ ctx, input }) => {
      const product = await loadProductForPremium(ctx.tenantId, input.productId);
      const strategy = getStrategy(product.productType.premiumStrategy);
      if (!strategy) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `No premium strategy registered for "${product.productType.premiumStrategy}".`,
        });
      }
      const [allPlans, rates] = await Promise.all([
        prisma.plan.findMany({
          where: { productId: input.productId },
          orderBy: { code: 'asc' },
        }),
        prisma.premiumRate.findMany({ where: { productId: input.productId } }),
      ]);
      // S25: optionally filter by effective window. Without `asOf`,
      // all plans contribute (back-compat with S24 callers).
      const plans = input.asOf
        ? allPlans.filter((p) => planActiveOn(p, input.asOf as Date))
        : allPlans;
      const strategyPlans: StrategyPlan[] = plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        coverBasis: p.coverBasis,
        stacksOn: p.stacksOn,
        selectionMode: p.selectionMode,
        schedule: (p.schedule as Record<string, unknown>) ?? {},
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
      }));
      const strategyRates = rates.map(rateRowToStrategy);
      const issues = strategy.validate(strategyPlans, strategyRates);
      const result = strategy.estimate({
        plans: strategyPlans,
        rates: strategyRates,
        groupTierHeadcount: input.groupTierHeadcount,
        planHeadcount: input.planHeadcount,
      });
      return {
        strategy: strategy.code,
        total: result.total,
        lines: result.lines,
        warnings: [...result.warnings, ...issues.map((i) => `${i.severity}: ${i.message}`)],
      };
    }),
});
