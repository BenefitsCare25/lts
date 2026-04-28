// =============================================================
// Products router (S15 — Product selection, Screen 3).
//
// A Product is an instance of a ProductType under a BenefitYear,
// bound to one Insurer (and optionally a Pool + TPA). This story
// is the picker only — Product.data is left as `{}` and gets its
// real fields filled in at S21 (Screen 5a, per-product details).
//
// Insurer filter (the AC's headline check): Insurer.productsSupported
// must contain the chosen ProductType.code, validated server-side
// regardless of what the UI presents.
//
// Tenant gate: Product is reached through BenefitYear → Policy →
// Client; every operation joins through `benefitYear: { policy:
// { client: { tenantId } } }`. Same pattern as benefitYears.
// =============================================================

import { prisma } from '@/server/db/client';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { router, tenantProcedure } from '../init';

// Single Ajv instance — compiles + caches schemas across requests.
// `strict: false` keeps catalogue-authored schemas tolerant of
// non-standard keywords (e.g. our own description fields).
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Format an Ajv error path + message for inline UI display.
function formatAjvError(err: ErrorObject): string {
  const path = err.instancePath || '/';
  return `${path} ${err.message ?? 'is invalid'}`;
}

const productInputSchema = z.object({
  productTypeId: z.string().min(1),
  insurerId: z.string().min(1),
  poolId: z.string().min(1).nullable(),
  tpaId: z.string().min(1).nullable(),
});

// Asserts the BenefitYear belongs to the caller's tenant and is
// editable (DRAFT). Published years are immutable.
async function assertEditableBenefitYear(tenantId: string, benefitYearId: string) {
  const by = await prisma.benefitYear.findFirst({
    where: { id: benefitYearId, policy: { client: { tenantId } } },
    select: { id: true, state: true },
  });
  if (!by) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Benefit year not found.' });
  }
  if (by.state !== 'DRAFT') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Products can only be edited on DRAFT benefit years.',
    });
  }
  return by;
}

// Asserts the Product belongs to the caller's tenant. Returns the row
// with its parent BenefitYear's state so callers can gate edits.
async function loadProduct(tenantId: string, productId: string) {
  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      benefitYear: { policy: { client: { tenantId } } },
    },
    select: { id: true, benefitYearId: true, benefitYear: { select: { state: true } } },
  });
  if (!product) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found.' });
  }
  return product;
}

// Loads Insurer + ProductType inside the caller's tenant, validating
// that the insurer supports the product type. Throws BAD_REQUEST on
// mismatch with a UI-friendly message.
async function assertInsurerSupportsProductType(
  tenantId: string,
  productTypeId: string,
  insurerId: string,
): Promise<{ productTypeCode: string; insurerName: string }> {
  const [productType, insurer] = await Promise.all([
    prisma.productType.findFirst({
      where: { id: productTypeId, tenantId },
      select: { code: true, name: true },
    }),
    prisma.insurer.findFirst({
      where: { id: insurerId, tenantId },
      select: { name: true, productsSupported: true, active: true },
    }),
  ]);
  if (!productType) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Product type not found in catalogue.' });
  }
  if (!insurer) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Insurer not found in registry.' });
  }
  if (!insurer.active) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${insurer.name} is marked inactive. Reactivate before assigning products.`,
    });
  }
  if (!insurer.productsSupported.includes(productType.code)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${insurer.name} does not support ${productType.code} (${productType.name}). Update the insurer registry or pick a different insurer.`,
    });
  }
  return { productTypeCode: productType.code, insurerName: insurer.name };
}

// Optional FK validations for Pool and TPA — both must belong to the tenant.
async function assertOptionalPoolAndTpa(
  tenantId: string,
  poolId: string | null,
  tpaId: string | null,
): Promise<void> {
  if (poolId) {
    const pool = await prisma.pool.findFirst({
      where: { id: poolId, tenantId },
      select: { id: true },
    });
    if (!pool) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pool not found in registry.' });
    }
  }
  if (tpaId) {
    const tpa = await prisma.tPA.findFirst({
      where: { id: tpaId, tenantId },
      select: { id: true, supportedInsurerIds: true, active: true },
    });
    if (!tpa) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'TPA not found in registry.' });
    }
    if (!tpa.active) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'TPA is marked inactive.' });
    }
  }
}

export const productsRouter = router({
  listByBenefitYear: tenantProcedure
    .input(z.object({ benefitYearId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      // Same scope check, but DRAFT-or-PUBLISHED both readable.
      const by = await prisma.benefitYear.findFirst({
        where: {
          id: input.benefitYearId,
          policy: { client: { tenantId: ctx.tenantId } },
        },
        select: { id: true, state: true },
      });
      if (!by) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Benefit year not found.' });
      }
      const products = await prisma.product.findMany({
        where: { benefitYearId: input.benefitYearId },
        include: {
          productType: { select: { id: true, code: true, name: true, premiumStrategy: true } },
          pool: { select: { id: true, name: true } },
          _count: { select: { plans: true } },
        },
      });
      // Hand-fetch insurer + tpa names since they're not relations on Product.
      const insurerIds = Array.from(new Set(products.map((p) => p.insurerId)));
      const tpaIds = Array.from(
        new Set(products.map((p) => p.tpaId).filter((id): id is string => id !== null)),
      );
      const [insurers, tpas] = await Promise.all([
        insurerIds.length > 0
          ? prisma.insurer.findMany({
              where: { id: { in: insurerIds }, tenantId: ctx.tenantId },
              select: { id: true, code: true, name: true },
            })
          : Promise.resolve([]),
        tpaIds.length > 0
          ? prisma.tPA.findMany({
              where: { id: { in: tpaIds }, tenantId: ctx.tenantId },
              select: { id: true, code: true, name: true },
            })
          : Promise.resolve([]),
      ]);
      const insurerById = new Map(insurers.map((i) => [i.id, i]));
      const tpaById = new Map(tpas.map((t) => [t.id, t]));
      return {
        benefitYearState: by.state,
        items: products.map((p) => ({
          ...p,
          insurer: insurerById.get(p.insurerId) ?? null,
          tpa: p.tpaId ? (tpaById.get(p.tpaId) ?? null) : null,
        })),
      };
    }),

  create: tenantProcedure
    .input(z.object({ benefitYearId: z.string().min(1) }).and(productInputSchema))
    .mutation(async ({ ctx, input }) => {
      await assertEditableBenefitYear(ctx.tenantId, input.benefitYearId);
      await assertInsurerSupportsProductType(ctx.tenantId, input.productTypeId, input.insurerId);
      await assertOptionalPoolAndTpa(ctx.tenantId, input.poolId, input.tpaId);
      // No unique constraint on (benefitYearId, productTypeId) — the
      // same product type can appear twice (e.g. a primary GHS + a
      // top-up GHS) under different insurers. Add deduplication later
      // if a real-world placement slip ever needs it.
      return prisma.product.create({
        data: {
          benefitYearId: input.benefitYearId,
          productTypeId: input.productTypeId,
          insurerId: input.insurerId,
          poolId: input.poolId,
          tpaId: input.tpaId,
          // Real product config arrives at S21 (Screen 5a).
          // Empty object satisfies the JSON column for now.
          data: {},
        },
      });
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const product = await prisma.product.findFirst({
      where: {
        id: input.id,
        benefitYear: { policy: { client: { tenantId: ctx.tenantId } } },
      },
      include: {
        productType: {
          select: { id: true, code: true, name: true, schema: true, planSchema: true },
        },
        benefitYear: {
          select: {
            id: true,
            state: true,
            startDate: true,
            endDate: true,
            policy: {
              select: { id: true, name: true, clientId: true },
            },
          },
        },
      },
    });
    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found.' });
    }
    // Hand-fetch insurer + tpa names like listByBenefitYear does.
    const [insurer, tpa, pool] = await Promise.all([
      prisma.insurer.findFirst({
        where: { id: product.insurerId, tenantId: ctx.tenantId },
        select: { id: true, code: true, name: true, productsSupported: true, active: true },
      }),
      product.tpaId
        ? prisma.tPA.findFirst({
            where: { id: product.tpaId, tenantId: ctx.tenantId },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve(null),
      product.poolId
        ? prisma.pool.findFirst({
            where: { id: product.poolId, tenantId: ctx.tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);
    return { ...product, insurer, tpa, pool };
  }),

  update: tenantProcedure
    .input(z.object({ id: z.string().min(1) }).and(productInputSchema))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadProduct(ctx.tenantId, input.id);
      if (existing.benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Products on a published benefit year are immutable.',
        });
      }
      await assertInsurerSupportsProductType(ctx.tenantId, input.productTypeId, input.insurerId);
      await assertOptionalPoolAndTpa(ctx.tenantId, input.poolId, input.tpaId);
      return prisma.product.update({
        where: { id: input.id },
        data: {
          productTypeId: input.productTypeId,
          insurerId: input.insurerId,
          poolId: input.poolId,
          tpaId: input.tpaId,
          versionId: { increment: 1 },
        },
      });
    }),

  // S21: per-product Details sub-tab. Validates the submitted JSON
  // against the ProductType.schema via Ajv before persisting. Returns
  // a structured error list that the UI can surface inline. Schema
  // can be edited in the catalogue admin (S12), so we recompile per
  // request — Ajv caches by reference, so unchanged schemas hit the
  // compile cache.
  updateData: tenantProcedure
    .input(
      z.object({
        id: z.string().min(1),
        // Free-form record; the actual shape comes from ProductType.schema.
        data: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.product.findFirst({
        where: {
          id: input.id,
          benefitYear: { policy: { client: { tenantId: ctx.tenantId } } },
        },
        select: {
          id: true,
          benefitYear: { select: { state: true } },
          productType: { select: { schema: true, code: true } },
        },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found.' });
      }
      if (existing.benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Products on a published benefit year are immutable.',
        });
      }

      // biome-ignore lint/suspicious/noExplicitAny: ProductType.schema is JSONB
      const validate = ajv.compile(existing.productType.schema as any);
      if (!validate(input.data)) {
        const errors = (validate.errors ?? []).map(formatAjvError);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Validation failed: ${errors.join('; ')}`,
        });
      }

      return prisma.product.update({
        where: { id: input.id },
        data: {
          data: input.data as Prisma.InputJsonValue,
          versionId: { increment: 1 },
        },
      });
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadProduct(ctx.tenantId, input.id);
      if (existing.benefitYear.state !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot delete products on a published benefit year. Archive the year first.',
        });
      }
      try {
        await prisma.product.delete({ where: { id: input.id } });
        return { id: input.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found.' });
          }
          if (err.code === 'P2003') {
            throw new TRPCError({
              code: 'CONFLICT',
              message:
                'Cannot delete: this product has linked plans, eligibility rules, or premium rates. Remove those first.',
            });
          }
        }
        throw err;
      }
    }),
});
