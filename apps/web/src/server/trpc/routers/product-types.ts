// =============================================================
// Product Types router (S12 — Product Catalogue editor).
//
// ProductType rows ARE the catalogue. Two JSON Schemas drive every
// downstream form (`schema` for product-instance fields, `planSchema`
// for plan rows). `premiumStrategy` picks one of five code-side
// strategy modules. `parsingRules` and `displayTemplate` are
// optional JSONB blobs consumed by the Excel parser (S29-S32) and
// the employee portal (Phase 2) respectively.
//
// Editing here bumps `version`. Phase 1 doesn't yet snapshot prior
// versions — the v2 plan describes immutable published versions
// (§5.5) but the supporting state machine arrives with S28 (publish
// workflow). Until then, edits mutate the row in place and increment
// the counter so consumers can detect drift.
// =============================================================

import { PREMIUM_STRATEGIES, type ProductTypeCode } from '@insurance-saas/shared-types';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

// Code: uppercase + digits + underscore. Same shape used by Insurer
// and TPA codes — keeps catalogue codes visually consistent. Allows
// ProductType codes that are NOT in PRODUCT_TYPE_CODES (e.g. tenant-
// specific custom products); we don't want to lock the catalogue
// into a fixed list.
const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use uppercase letters, digits, and underscores only.');

// JSON value schema — accepts objects/arrays/primitives but rejects
// `undefined`. Stored as JSONB in Postgres.
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const productTypeInputSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  premiumStrategy: z.enum(PREMIUM_STRATEGIES),
  // Both schemas are required (per v2 plan §3.5 every ProductType
  // declares product-level + plan-level shapes); validation that
  // each is itself a JSON Schema is downstream Ajv's job.
  schema: z.record(jsonValueSchema),
  planSchema: z.record(jsonValueSchema),
  parsingRules: z.record(jsonValueSchema).nullable(),
  displayTemplate: z.record(jsonValueSchema).nullable(),
});

export const productTypesRouter = router({
  list: tenantProcedure.query(({ ctx }) =>
    ctx.db.productType.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        premiumStrategy: true,
        version: true,
      },
    }),
  ),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const productType = await ctx.db.productType.findFirst({ where: { id: input.id } });
    if (!productType)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product type not found.' });
    return productType;
  }),

  create: adminProcedure.input(productTypeInputSchema).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.db.productType.create({
        data: {
          tenantId: ctx.tenantId,
          code: input.code,
          name: input.name,
          premiumStrategy: input.premiumStrategy,
          schema: input.schema as Prisma.InputJsonValue,
          planSchema: input.planSchema as Prisma.InputJsonValue,
          parsingRules:
            input.parsingRules === null
              ? Prisma.JsonNull
              : (input.parsingRules as Prisma.InputJsonValue),
          displayTemplate:
            input.displayTemplate === null
              ? Prisma.JsonNull
              : (input.displayTemplate as Prisma.InputJsonValue),
          version: 1,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A product type with code "${input.code}" already exists.`,
        });
      }
      throw err;
    }
  }),

  update: adminProcedure
    .input(z.object({ id: z.string().min(1), data: productTypeInputSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.productType.update({
          where: { id: input.id },
          data: {
            code: input.data.code,
            name: input.data.name,
            premiumStrategy: input.data.premiumStrategy,
            schema: input.data.schema as Prisma.InputJsonValue,
            planSchema: input.data.planSchema as Prisma.InputJsonValue,
            parsingRules:
              input.data.parsingRules === null
                ? Prisma.JsonNull
                : (input.data.parsingRules as Prisma.InputJsonValue),
            displayTemplate:
              input.data.displayTemplate === null
                ? Prisma.JsonNull
                : (input.data.displayTemplate as Prisma.InputJsonValue),
            // Bump version on every save. S15+ Product instances will
            // pin themselves to a version (currently they don't, so
            // this is a no-op consumer-side until S15).
            version: { increment: 1 },
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `A product type with code "${input.data.code}" already exists.`,
            });
          }
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Product type not found.' });
          }
        }
        throw err;
      }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.db.productType.delete({ where: { id: input.id } });
        return { id: input.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Product type not found.' });
          }
          // P2003 = foreign key violation. Once Product instances
          // reference ProductType (S15+), deleting an in-use type
          // surfaces here.
          if (err.code === 'P2003') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Product type is in use by one or more products.',
            });
          }
        }
        throw err;
      }
    }),
});

// Re-export to silence "unused import" if a consumer wants the type
// alongside this router's procedures.
export type { ProductTypeCode };
