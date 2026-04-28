// =============================================================
// Policies router (S14 — Policy + PolicyEntity, Screen 2).
//
// Policy is reached through Client, not directly tenant-scoped,
// so every operation begins by asserting the client belongs to
// the caller's tenant via ctx.db.client.findFirst (which IS
// tenant-scoped via the Prisma extension). After that we use
// the underlying prisma client directly because the extension
// no-ops on non-TENANT models.
//
// Optimistic locking: update accepts `expectedVersionId` and
// bumps Policy.versionId by 1 on every save. A mismatch surfaces
// as CONFLICT — the UI is expected to refetch and show a diff.
//
// PolicyEntity rows are managed via delete-and-recreate inside a
// transaction (same pattern as Pool memberships in S10). Cleaner
// than diffing for the size we expect (<10 entities per policy).
// =============================================================

import { prisma } from '@/server/db/client';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

// PolicyEntity input. id is optional (existing rows carry it; new
// rows omit it). rateOverrides is a free-form JSONB blob — schema
// validation against per-product schemas is a S15 concern.
const policyEntityInputSchema = z.object({
  id: z.string().min(1).optional(),
  legalName: z.string().trim().min(1).max(200),
  policyNumber: z.string().trim().min(1).max(80),
  address: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  headcountEstimate: z.number().int().min(0).max(1_000_000).nullable(),
  isMaster: z.boolean().default(false),
  // null = inherit from product/plan; object = per-product overrides keyed
  // by product code. Validated against ProductType schemas at apply-time.
  rateOverrides: z.record(z.unknown()).nullable(),
});

const policyInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  entities: z.array(policyEntityInputSchema).max(50),
});

type PolicyInput = z.infer<typeof policyInputSchema>;

// Verifies the client exists and belongs to the caller's tenant.
// ctx.db.client.findFirst is tenant-scoped via the Prisma extension,
// so a client from another tenant returns null and we throw NOT_FOUND.
async function assertClient(
  // biome-ignore lint/suspicious/noExplicitAny: extended Prisma client type
  db: any,
  clientId: string,
): Promise<void> {
  const client = await db.client.findFirst({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
  }
}

// Cross-row invariants applied on create + update.
// - Exactly zero or one master entity (zero is allowed during draft).
// - Policy numbers unique within the policy. (DB also enforces this
//   via the @@unique([policyId, policyNumber]) constraint, but
//   throwing a friendly message early beats the P2002 surface.)
function assertEntityInvariants(input: PolicyInput): void {
  const masters = input.entities.filter((e) => e.isMaster);
  if (masters.length > 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only one entity can be marked as the master policyholder.',
    });
  }
  const numbers = input.entities.map((e) => e.policyNumber.trim());
  const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (dupes.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Duplicate policy number "${dupes[0]}" — each entity needs a unique number.`,
    });
  }
}

// Prisma's JSON helpers: literal SQL NULL needs Prisma.JsonNull;
// raw `null` is a TypeScript-only sentinel that Prisma rejects.
function rateOverridesToJson(
  v: Record<string, unknown> | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (v === null) return Prisma.JsonNull;
  return v as Prisma.InputJsonValue;
}

export const policiesRouter = router({
  // List policies for a client. Returns empty array for cross-tenant clients
  // (the assertion throws NOT_FOUND first, but defence in depth: the inner
  // findMany filters by clientId only, never reaching another tenant's rows).
  listByClient: tenantProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertClient(ctx.db, input.clientId);
      return prisma.policy.findMany({
        where: { clientId: input.clientId },
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { entities: true, benefitYears: true } },
        },
      });
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const policy = await prisma.policy.findFirst({
      where: { id: input.id, client: { tenantId: ctx.tenantId } },
      include: {
        entities: { orderBy: [{ isMaster: 'desc' }, { legalName: 'asc' }] },
        client: { select: { id: true, legalName: true } },
      },
    });
    if (!policy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
    return policy;
  }),

  create: adminProcedure
    .input(z.object({ clientId: z.string().min(1), data: policyInputSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertClient(ctx.db, input.clientId);
      assertEntityInvariants(input.data);

      // S17: every new Policy spawns a DRAFT BenefitYear running for
      // 12 months from today. Brokers can edit the dates or add
      // additional years from the policy edit page.
      const startDate = new Date();
      startDate.setUTCHours(0, 0, 0, 0);
      const endDate = new Date(startDate);
      endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
      endDate.setUTCDate(endDate.getUTCDate() - 1);

      try {
        return await prisma.policy.create({
          data: {
            clientId: input.clientId,
            name: input.data.name,
            entities: {
              create: input.data.entities.map((e) => ({
                legalName: e.legalName,
                policyNumber: e.policyNumber.trim(),
                address: e.address,
                headcountEstimate: e.headcountEstimate,
                isMaster: e.isMaster,
                rateOverrides: rateOverridesToJson(e.rateOverrides),
              })),
            },
            benefitYears: {
              create: [{ startDate, endDate }],
            },
          },
          include: { entities: true, benefitYears: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Duplicate policy number within this policy.',
          });
        }
        throw err;
      }
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        expectedVersionId: z.number().int().min(1),
        data: policyInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEntityInvariants(input.data);

      // Resolve + verify the policy belongs to the tenant. Returning
      // NOT_FOUND for cross-tenant ids is the safer default than 403.
      const existing = await prisma.policy.findFirst({
        where: { id: input.id, client: { tenantId: ctx.tenantId } },
        select: { id: true, versionId: true },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
      }
      if (existing.versionId !== input.expectedVersionId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This policy was modified by another session. Refresh and reapply your changes.',
        });
      }

      // Wipe-and-recreate entity rows inside a transaction. Optimistic
      // lock bumps Policy.versionId by 1 — the next save from the
      // stale client will hit the version-mismatch branch above.
      try {
        const [, , policy] = await prisma.$transaction([
          prisma.policyEntity.deleteMany({ where: { policyId: input.id } }),
          prisma.policy.update({
            where: { id: input.id },
            data: {
              name: input.data.name,
              versionId: { increment: 1 },
              entities: {
                create: input.data.entities.map((e) => ({
                  legalName: e.legalName,
                  policyNumber: e.policyNumber.trim(),
                  address: e.address,
                  headcountEstimate: e.headcountEstimate,
                  isMaster: e.isMaster,
                  rateOverrides: rateOverridesToJson(e.rateOverrides),
                })),
              },
            },
          }),
          prisma.policy.findUniqueOrThrow({
            where: { id: input.id },
            include: { entities: true },
          }),
        ]);
        return policy;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2002') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Duplicate policy number within this policy.',
            });
          }
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
          }
        }
        throw err;
      }
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Re-verify before deleting to keep cross-tenant safety.
      const existing = await prisma.policy.findFirst({
        where: { id: input.id, client: { tenantId: ctx.tenantId } },
        select: { id: true, _count: { select: { benefitYears: true } } },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
      }
      if (existing._count.benefitYears > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Cannot delete: this policy has linked benefit years. Archive them first.',
        });
      }
      try {
        await prisma.$transaction([
          prisma.policyEntity.deleteMany({ where: { policyId: input.id } }),
          prisma.policy.delete({ where: { id: input.id } }),
        ]);
        return { id: input.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
        }
        throw err;
      }
    }),
});
