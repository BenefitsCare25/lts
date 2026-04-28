// =============================================================
// Product eligibility router (S23 — Eligibility matrix, Screen 5c).
//
// One row per (Product, BenefitGroup) saying "members of this group
// on this product default to plan X". Absence of a row = ineligible
// (Screen 6 will surface missing assignments as a warning).
//
// Tenant gate: ProductEligibility → Product → BenefitYear → Policy
// → Client. Mutations only on DRAFT benefit years.
// =============================================================

import { prisma } from '@/server/db/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, tenantProcedure } from '../init';

async function loadProductForEligibility(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      benefitYear: { policy: { client: { tenantId } } },
    },
    select: {
      id: true,
      benefitYear: { select: { state: true, policy: { select: { id: true } } } },
    },
  });
  if (!product) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found.' });
  }
  return product;
}

export const productEligibilityRouter = router({
  // Matrix payload: every benefit group on the product's policy plus
  // every plan on the product, with the current eligibility row when
  // one exists. Lets the UI render the full matrix without separate
  // round-trips to benefitGroups + plans + eligibility.
  matrixForProduct: tenantProcedure
    .input(z.object({ productId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const product = await loadProductForEligibility(ctx.tenantId, input.productId);
      const [groups, plans, eligibility] = await Promise.all([
        prisma.benefitGroup.findMany({
          where: { policyId: product.benefitYear.policy.id },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, description: true },
        }),
        prisma.plan.findMany({
          where: { productId: input.productId },
          orderBy: [{ stacksOn: 'asc' }, { code: 'asc' }],
          select: { id: true, code: true, name: true },
        }),
        prisma.productEligibility.findMany({
          where: { productId: input.productId },
          select: { id: true, benefitGroupId: true, defaultPlanId: true },
        }),
      ]);
      const eligibilityByGroup = new Map(eligibility.map((e) => [e.benefitGroupId, e]));
      return {
        benefitYearState: product.benefitYear.state,
        groups,
        plans,
        rows: groups.map((g) => ({
          benefitGroupId: g.id,
          defaultPlanId: eligibilityByGroup.get(g.id)?.defaultPlanId ?? null,
        })),
      };
    }),

  // Bulk replace eligibility rows for one product. Saves are
  // idempotent: empty entries (defaultPlanId === null) drop the
  // existing row, non-empty entries upsert. Wrapped in a transaction
  // so partial saves don't strand orphaned rows.
  setForProduct: tenantProcedure
    .input(
      z.object({
        productId: z.string().min(1),
        entries: z.array(
          z.object({
            benefitGroupId: z.string().min(1),
            defaultPlanId: z.string().min(1).nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const product = await loadProductForEligibility(ctx.tenantId, input.productId);
      if (product.benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Eligibility can only be edited on DRAFT benefit years.',
        });
      }

      // Validate: every benefitGroupId belongs to the same policy;
      // every defaultPlanId belongs to the same product.
      const policyId = product.benefitYear.policy.id;
      const [validGroupIds, validPlanIds] = await Promise.all([
        prisma.benefitGroup.findMany({
          where: { policyId, id: { in: input.entries.map((e) => e.benefitGroupId) } },
          select: { id: true },
        }),
        input.entries.some((e) => e.defaultPlanId !== null)
          ? prisma.plan.findMany({
              where: {
                productId: input.productId,
                id: {
                  in: input.entries
                    .map((e) => e.defaultPlanId)
                    .filter((id): id is string => id !== null),
                },
              },
              select: { id: true },
            })
          : Promise.resolve([]),
      ]);
      const groupIdSet = new Set(validGroupIds.map((g) => g.id));
      const planIdSet = new Set(validPlanIds.map((p) => p.id));

      for (const entry of input.entries) {
        if (!groupIdSet.has(entry.benefitGroupId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Benefit group ${entry.benefitGroupId} is not on this policy.`,
          });
        }
        if (entry.defaultPlanId !== null && !planIdSet.has(entry.defaultPlanId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Plan ${entry.defaultPlanId} is not on this product.`,
          });
        }
      }

      // Apply: per entry, upsert when defaultPlanId is set, delete when null.
      // Wrapped in a transaction so the matrix is consistent on failure.
      const ops = input.entries.map((entry) => {
        if (entry.defaultPlanId === null) {
          return prisma.productEligibility.deleteMany({
            where: {
              productId: input.productId,
              benefitGroupId: entry.benefitGroupId,
            },
          });
        }
        return prisma.productEligibility.upsert({
          where: {
            productId_benefitGroupId: {
              productId: input.productId,
              benefitGroupId: entry.benefitGroupId,
            },
          },
          update: { defaultPlanId: entry.defaultPlanId },
          create: {
            productId: input.productId,
            benefitGroupId: entry.benefitGroupId,
            defaultPlanId: entry.defaultPlanId,
          },
        });
      });
      await prisma.$transaction(ops);
      return { saved: input.entries.length };
    }),
});
