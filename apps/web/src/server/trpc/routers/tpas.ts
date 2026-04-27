// =============================================================
// TPAs router (S9 — TPA Registry CRUD).
//
// Mirrors the insurers router shape: list / byId / create / update
// / delete via tenantProcedure. Supported insurers stored as a
// String[] referencing Insurer.id within the same tenant. We don't
// foreign-key it because product schemas aren't relational and
// keeping the column free-form simplifies catalogue migrations.
// =============================================================

import { TPA_FEED_FORMATS } from '@insurance-saas/shared-types';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, tenantProcedure } from '../init';

const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use uppercase letters, digits, and underscores only.');

const tpaInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: codeSchema,
  supportedInsurerIds: z.array(z.string().min(1)),
  feedFormat: z.enum(TPA_FEED_FORMATS),
  active: z.boolean().default(true),
});

export const tpasRouter = router({
  list: tenantProcedure.query(({ ctx }) =>
    ctx.db.tPA.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    }),
  ),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const tpa = await ctx.db.tPA.findFirst({ where: { id: input.id } });
    if (!tpa) throw new TRPCError({ code: 'NOT_FOUND', message: 'TPA not found.' });
    return tpa;
  }),

  create: tenantProcedure.input(tpaInputSchema).mutation(async ({ ctx, input }) => {
    // Defence-in-depth: every insurerId must belong to the current tenant.
    // The Prisma extension already filters by tenantId on findMany.
    if (input.supportedInsurerIds.length > 0) {
      const matched = await ctx.db.insurer.findMany({
        where: { id: { in: input.supportedInsurerIds } },
        select: { id: true },
      });
      if (matched.length !== input.supportedInsurerIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One or more selected insurers do not exist for this tenant.',
        });
      }
    }
    try {
      return await ctx.db.tPA.create({ data: { ...input, tenantId: ctx.tenantId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A TPA with code "${input.code}" already exists.`,
        });
      }
      throw err;
    }
  }),

  update: tenantProcedure
    .input(z.object({ id: z.string().min(1), data: tpaInputSchema }))
    .mutation(async ({ ctx, input }) => {
      if (input.data.supportedInsurerIds.length > 0) {
        const matched = await ctx.db.insurer.findMany({
          where: { id: { in: input.data.supportedInsurerIds } },
          select: { id: true },
        });
        if (matched.length !== input.data.supportedInsurerIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more selected insurers do not exist for this tenant.',
          });
        }
      }
      try {
        return await ctx.db.tPA.update({ where: { id: input.id }, data: input.data });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `A TPA with code "${input.data.code}" already exists.`,
            });
          }
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'TPA not found.' });
          }
        }
        throw err;
      }
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.db.tPA.delete({ where: { id: input.id } });
        return { id: input.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'TPA not found.' });
        }
        throw err;
      }
    }),
});
