// =============================================================
// Pools router (S10 — Pool Registry CRUD).
//
// A Pool groups one or more Insurers under a captive / pool /
// risk-sharing arrangement. Pool memberships carry an optional
// share-basis-points value (0-10000 = 0%-100%); null means
// "unspecified" rather than zero — the brokerage may know an
// insurer is in the pool without knowing the share split yet.
//
// Pool itself is tenant-scoped (the Prisma extension injects
// tenantId on every CRUD); PoolMembership is reached only via
// Pool, so cross-tenant isolation is enforced one level up.
// =============================================================

import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, tenantProcedure } from '../init';

const memberSchema = z.object({
  insurerId: z.string().min(1),
  // basis points: 0 = 0%, 10000 = 100%. Null = unknown share.
  shareBps: z.number().int().min(0).max(10000).nullable(),
});

const poolInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable(),
  members: z.array(memberSchema).max(20),
});

async function assertInsurersBelongToTenant(
  // biome-ignore lint/suspicious/noExplicitAny: db type is the extended Prisma client
  db: any,
  insurerIds: string[],
): Promise<void> {
  if (insurerIds.length === 0) return;
  const matched = await db.insurer.findMany({
    where: { id: { in: insurerIds } },
    select: { id: true },
  });
  if (matched.length !== insurerIds.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'One or more selected insurers do not exist for this tenant.',
    });
  }
}

export const poolsRouter = router({
  list: tenantProcedure.query(({ ctx }) =>
    ctx.db.pool.findMany({
      include: { members: true },
      orderBy: { name: 'asc' },
    }),
  ),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const pool = await ctx.db.pool.findFirst({
      where: { id: input.id },
      include: { members: true },
    });
    if (!pool) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pool not found.' });
    return pool;
  }),

  create: tenantProcedure.input(poolInputSchema).mutation(async ({ ctx, input }) => {
    await assertInsurersBelongToTenant(
      ctx.db,
      input.members.map((m) => m.insurerId),
    );
    return ctx.db.pool.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        members: {
          create: input.members.map((m) => ({
            insurerId: m.insurerId,
            shareBps: m.shareBps,
          })),
        },
      },
      include: { members: true },
    });
  }),

  update: tenantProcedure
    .input(z.object({ id: z.string().min(1), data: poolInputSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertInsurersBelongToTenant(
        ctx.db,
        input.data.members.map((m) => m.insurerId),
      );
      try {
        // Delete-and-recreate the membership rows. Cleaner than
        // diffing for the size we expect (≤20 members per pool).
        return await ctx.db.pool.update({
          where: { id: input.id },
          data: {
            name: input.data.name,
            description: input.data.description,
            members: {
              deleteMany: {},
              create: input.data.members.map((m) => ({
                insurerId: m.insurerId,
                shareBps: m.shareBps,
              })),
            },
          },
          include: { members: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Pool not found.' });
        }
        throw err;
      }
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        // PoolMembership has no onDelete:Cascade in the schema, so
        // wipe its rows first within a transaction.
        await ctx.db.$transaction([
          ctx.db.poolMembership.deleteMany({ where: { poolId: input.id } }),
          ctx.db.pool.delete({ where: { id: input.id } }),
        ]);
        return { id: input.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Pool not found.' });
        }
        throw err;
      }
    }),
});
