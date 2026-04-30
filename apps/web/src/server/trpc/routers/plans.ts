// =============================================================
// Plans router.
//
// Each Plan belongs to one Product (instance of a ProductType under
// a BenefitYear). Schema validation: the full plan record (code +
// name + coverBasis + stacksOn + selectionMode + schedule + effective
// dates) is Ajv-validated against `ProductType.planSchema` on every
// write.
//
// stacksOn enforces:
//   - the referenced plan exists on the same Product
//   - no cycles (A→B→A or self-loops)
//
// Tenant gate: Plan → Product → BenefitYear → Policy → Client. Same
// defence-in-depth pattern as products/benefit-years.
//
// DRAFT-only mutations: mutations on Plans whose grandparent
// BenefitYear is PUBLISHED/ARCHIVED are rejected.
// =============================================================

import { formatAjvError, safeCompile } from '@/server/catalogue/ajv';
import { prisma } from '@/server/db/client';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

const planInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^P[A-Z0-9]+$/, 'Plan codes must start with P and use uppercase + digits.'),
  name: z.string().trim().min(1).max(200),
  coverBasis: z.string().trim().min(1).max(40),
  stacksOn: z.string().min(1).nullable(),
  selectionMode: z.enum(['broker_default', 'employee_flex']).default('broker_default'),
  effectiveFrom: z.coerce.date().nullable(),
  effectiveTo: z.coerce.date().nullable(),
  schedule: z.record(z.unknown()),
});

type PlanInput = z.infer<typeof planInputSchema>;

// Asserts the Product belongs to the caller's tenant. Returns the
// product with grandparent state for editability checks.
async function loadProductWithBenefitYear(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      benefitYear: { policy: { client: { tenantId } } },
    },
    select: {
      id: true,
      benefitYear: { select: { state: true } },
      productType: { select: { id: true, planSchema: true, code: true, version: true } },
    },
  });
  if (!product) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found.' });
  }
  return product;
}

async function loadPlanWithProduct(tenantId: string, planId: string) {
  const plan = await prisma.plan.findFirst({
    where: {
      id: planId,
      product: { benefitYear: { policy: { client: { tenantId } } } },
    },
    select: {
      id: true,
      productId: true,
      product: {
        select: {
          benefitYear: { select: { state: true } },
          productType: { select: { id: true, planSchema: true, version: true } },
        },
      },
    },
  });
  if (!plan) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
  }
  return plan;
}

// Validates the (possibly-new) plan's full row against productType.planSchema.
// Throws BAD_REQUEST with all paths + reasons on failure. The
// `cacheKey` should match the format used in review.ts so a single
// compile is shared across the validator + review.validate hits.
function validateAgainstPlanSchema(input: PlanInput, planSchema: unknown, cacheKey?: string): void {
  const compiled = safeCompile(planSchema, cacheKey);
  if (!compiled.ok) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Plan schema in catalogue failed to compile.',
    });
  }
  // Construct the JSON shape the schema expects (matches the seeded
  // planSchema in S16: { code, name, coverBasis, stacksOn, selectionMode, schedule, ... }).
  const candidate = {
    code: input.code,
    name: input.name,
    coverBasis: input.coverBasis,
    stacksOn: input.stacksOn,
    selectionMode: input.selectionMode,
    schedule: input.schedule,
    effectiveFrom: input.effectiveFrom?.toISOString().slice(0, 10) ?? null,
    effectiveTo: input.effectiveTo?.toISOString().slice(0, 10) ?? null,
  };
  if (!compiled.validate(candidate)) {
    const errors = (compiled.validate.errors ?? []).map(formatAjvError);
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Plan validation failed: ${errors.join('; ')}`,
    });
  }
}

// Validates the stacksOn target: must exist, must belong to the same
// product, must not create a cycle (including a direct self-loop).
// Every Plan lookup scopes through `productId` to keep the cycle
// walker from traversing into a different tenant's plans (defence
// in depth — `validateStacksOn`'s first hop already requires same
// product, but the chain walker would otherwise follow stacksOn
// blindly).
async function validateStacksOn(
  productId: string,
  stacksOn: string | null,
  selfPlanId?: string,
): Promise<void> {
  if (!stacksOn) return;
  if (stacksOn === selfPlanId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'A plan cannot stack on itself.' });
  }
  const target = await prisma.plan.findFirst({
    where: { id: stacksOn, productId },
    select: { id: true, productId: true, stacksOn: true },
  });
  if (!target) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'stacksOn must reference another plan on the same product.',
    });
  }
  const visited = new Set<string>([stacksOn]);
  let cursor: string | null = target.stacksOn;
  while (cursor) {
    if (cursor === selfPlanId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'stacksOn would create a circular dependency.',
      });
    }
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const next: { stacksOn: string | null } | null = await prisma.plan.findFirst({
      where: { id: cursor, productId },
      select: { stacksOn: true },
    });
    cursor = next?.stacksOn ?? null;
  }
}

export const plansRouter = router({
  listByProduct: tenantProcedure
    .input(z.object({ productId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await loadProductWithBenefitYear(ctx.tenantId, input.productId);
      return prisma.plan.findMany({
        where: { productId: input.productId },
        orderBy: [{ stacksOn: 'asc' }, { code: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          coverBasis: true,
          stacksOn: true,
          selectionMode: true,
          schedule: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      });
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const plan = await prisma.plan.findFirst({
      where: {
        id: input.id,
        product: { benefitYear: { policy: { client: { tenantId: ctx.tenantId } } } },
      },
      include: {
        product: {
          select: {
            id: true,
            productType: {
              select: { id: true, code: true, name: true, planSchema: true },
            },
            benefitYear: {
              select: {
                id: true,
                state: true,
                policy: { select: { id: true, name: true, clientId: true } },
              },
            },
          },
        },
      },
    });
    if (!plan) throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
    return plan;
  }),

  create: adminProcedure
    .input(z.object({ productId: z.string().min(1) }).and(planInputSchema))
    .mutation(async ({ ctx, input }) => {
      const product = await loadProductWithBenefitYear(ctx.tenantId, input.productId);
      if (product.benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Plans can only be edited on DRAFT benefit years.',
        });
      }
      validateAgainstPlanSchema(
        input,
        product.productType.planSchema,
        `product-type:${product.productType.id}:${product.productType.version}:planSchema`,
      );
      await validateStacksOn(input.productId, input.stacksOn);
      try {
        return await prisma.plan.create({
          data: {
            productId: input.productId,
            code: input.code,
            name: input.name,
            coverBasis: input.coverBasis,
            stacksOn: input.stacksOn,
            selectionMode: input.selectionMode,
            schedule: input.schedule as Prisma.InputJsonValue,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A plan with code "${input.code}" already exists on this product.`,
          });
        }
        throw err;
      }
    }),

  update: adminProcedure
    .input(z.object({ id: z.string().min(1) }).and(planInputSchema))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadPlanWithProduct(ctx.tenantId, input.id);
      if (existing.product.benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Plans on a published benefit year are immutable.',
        });
      }
      validateAgainstPlanSchema(
        input,
        existing.product.productType.planSchema,
        `product-type:${existing.product.productType.id}:${existing.product.productType.version}:planSchema`,
      );
      await validateStacksOn(existing.productId, input.stacksOn, input.id);
      try {
        return await prisma.plan.update({
          where: { id: input.id },
          data: {
            code: input.code,
            name: input.name,
            coverBasis: input.coverBasis,
            stacksOn: input.stacksOn,
            selectionMode: input.selectionMode,
            schedule: input.schedule as Prisma.InputJsonValue,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `A plan with code "${input.code}" already exists on this product.`,
            });
          }
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
          }
        }
        throw err;
      }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadPlanWithProduct(ctx.tenantId, input.id);
      if (existing.product.benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete plans on a published benefit year.',
        });
      }
      // Reject delete if any other plan stacksOn this one — caller
      // should detach the rider first, otherwise eligibility breaks.
      const ridersCount = await prisma.plan.count({ where: { stacksOn: input.id } });
      if (ridersCount > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'This plan is referenced as a base by another plan (stacksOn). Detach the rider first.',
        });
      }
      try {
        await prisma.plan.delete({ where: { id: input.id } });
        return { id: input.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Plan not found.' });
          }
          if (err.code === 'P2003') {
            throw new TRPCError({
              code: 'CONFLICT',
              message:
                'Cannot delete: this plan is referenced by eligibility rules or premium rates.',
            });
          }
        }
        throw err;
      }
    }),
});
