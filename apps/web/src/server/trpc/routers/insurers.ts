// =============================================================
// Insurers router (S8 — Insurer Registry CRUD).
//
// Every procedure runs through tenantProcedure: the request
// context already carries a Prisma client pre-scoped to the
// caller's tenant, so handlers never pass tenantId explicitly.
// =============================================================

import { CLAIM_FEED_PROTOCOLS, PRODUCT_TYPE_CODES } from '@insurance-saas/shared-types';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, tenantProcedure } from '../init';

// Code: short uppercase identifier, unique within a tenant.
// Constrained pattern matches the v2 plan §3.4 examples (TM_LIFE, GE_LIFE, ...).
const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use uppercase letters, digits, and underscores only.');

const insurerInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: codeSchema,
  productsSupported: z
    .array(z.enum(PRODUCT_TYPE_CODES))
    .min(1, 'Select at least one product type.'),
  claimFeedProtocol: z.enum(CLAIM_FEED_PROTOCOLS).nullable(),
  active: z.boolean().default(true),
});

export const insurersRouter = router({
  list: tenantProcedure.query(({ ctx }) =>
    ctx.db.insurer.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    }),
  ),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const insurer = await ctx.db.insurer.findFirst({ where: { id: input.id } });
    if (!insurer) throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found.' });
    return insurer;
  }),

  create: tenantProcedure.input(insurerInputSchema).mutation(async ({ ctx, input }) => {
    try {
      // tenantId is auto-injected by the Prisma $extends middleware in
      // server/db/tenant.ts; we pass ctx.tenantId here only to satisfy
      // Prisma's static type. The extension would set it to the same
      // value either way.
      return await ctx.db.insurer.create({ data: { ...input, tenantId: ctx.tenantId } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' // unique constraint
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `An insurer with code "${input.code}" already exists.`,
        });
      }
      throw err;
    }
  }),

  update: tenantProcedure
    .input(z.object({ id: z.string().min(1), data: insurerInputSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.insurer.update({ where: { id: input.id }, data: input.data });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `An insurer with code "${input.data.code}" already exists.`,
            });
          }
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found.' });
          }
        }
        throw err;
      }
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.db.insurer.delete({ where: { id: input.id } });
        return { id: input.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Insurer not found.' });
        }
        throw err;
      }
    }),
});
