// =============================================================
// Benefit years router (S17 — Benefit year + draft state).
//
// One Policy holds many BenefitYears. Each is a versioned snapshot
// of the configuration for a coverage period (typically 12 months).
// Lifecycle: DRAFT → PUBLISHED → ARCHIVED (no return path).
//
// Tenant gate: BenefitYear is reached through Policy → Client, so
// every operation joins through `policy: { client: { tenantId } }`.
// Same defence-in-depth pattern as the policies router.
//
// State transitions:
//   DRAFT → PUBLISHED   (TENANT_ADMIN / BROKER_ADMIN only)
//   DRAFT → ARCHIVED    (any signed-in tenant user)
//   PUBLISHED → ARCHIVED (TENANT_ADMIN / BROKER_ADMIN only)
//
// Once PUBLISHED, dates and configuration are immutable per v2
// plan §2.4 — the year carries its data forward into next year's
// DRAFT via the publish workflow.
// =============================================================

import { prisma } from '@/server/db/client';
import { BenefitYearState, Prisma, UserRole } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

const PUBLISH_ROLES = new Set<UserRole>([UserRole.TENANT_ADMIN, UserRole.BROKER_ADMIN]);

const datesSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((v) => v.endDate.getTime() > v.startDate.getTime(), {
    message: 'End date must fall after the start date.',
    path: ['endDate'],
  });

// Read the caller's role from the user record. The session token
// carries it too, but going to the DB keeps this router independent
// of the session shape and survives mid-session role changes.
async function loadCallerRole(
  db: import('@/server/db/tenant').TenantDb,
  userId: string,
): Promise<UserRole> {
  // findFirst (not findUnique) so the tenant-scoped extension applies
  // — defends against a stale session JWT for a user moved/deleted
  // outside the current tenant.
  const user = await db.user.findFirst({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not provisioned.' });
  }
  return user.role;
}

// Asserts the policy is reachable through the caller's tenant.
async function assertPolicy(tenantId: string, policyId: string): Promise<void> {
  const policy = await prisma.policy.findFirst({
    where: { id: policyId, client: { tenantId } },
    select: { id: true },
  });
  if (!policy) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
  }
}

// Loads a benefit year scoped through tenant. Used by every mutation.
async function loadBenefitYear(tenantId: string, id: string) {
  const by = await prisma.benefitYear.findFirst({
    where: { id, policy: { client: { tenantId } } },
    select: { id: true, state: true, policyId: true },
  });
  if (!by) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Benefit year not found.' });
  }
  return by;
}

// State-transition graph. Returns null when the move is allowed,
// otherwise a user-facing reason for the rejection.
function rejectTransition(from: BenefitYearState, to: BenefitYearState): string | null {
  if (from === to) return null;
  if (from === BenefitYearState.DRAFT && to === BenefitYearState.PUBLISHED) return null;
  if (from === BenefitYearState.DRAFT && to === BenefitYearState.ARCHIVED) return null;
  if (from === BenefitYearState.PUBLISHED && to === BenefitYearState.ARCHIVED) return null;
  return `Cannot transition from ${from} to ${to}.`;
}

export const benefitYearsRouter = router({
  listByPolicy: tenantProcedure
    .input(z.object({ policyId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertPolicy(ctx.tenantId, input.policyId);
      return prisma.benefitYear.findMany({
        where: { policyId: input.policyId },
        orderBy: { startDate: 'desc' },
        include: {
          _count: { select: { products: true } },
        },
      });
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const by = await prisma.benefitYear.findFirst({
      where: { id: input.id, policy: { client: { tenantId: ctx.tenantId } } },
      include: {
        policy: { select: { id: true, name: true, clientId: true } },
      },
    });
    if (!by) throw new TRPCError({ code: 'NOT_FOUND', message: 'Benefit year not found.' });
    return by;
  }),

  // Add an additional benefit year to an existing policy. The first year
  // is auto-created when the Policy itself is created (see policies.create).
  create: adminProcedure
    .input(z.object({ policyId: z.string().min(1) }).and(datesSchema))
    .mutation(async ({ ctx, input }) => {
      await assertPolicy(ctx.tenantId, input.policyId);
      try {
        return await prisma.benefitYear.create({
          data: {
            policyId: input.policyId,
            startDate: input.startDate,
            endDate: input.endDate,
            state: BenefitYearState.DRAFT,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A benefit year with this start date already exists for the policy.',
          });
        }
        throw err;
      }
    }),

  // Edit dates on a DRAFT year. PUBLISHED years are immutable.
  updateDates: adminProcedure
    .input(z.object({ id: z.string().min(1) }).and(datesSchema))
    .mutation(async ({ ctx, input }) => {
      const by = await loadBenefitYear(ctx.tenantId, input.id);
      if (by.state !== BenefitYearState.DRAFT) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only DRAFT benefit years can be edited. Publish, then add a new year.',
        });
      }
      try {
        return await prisma.benefitYear.update({
          where: { id: input.id },
          data: { startDate: input.startDate, endDate: input.endDate },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Another benefit year on this policy already starts on that date.',
          });
        }
        throw err;
      }
    }),

  setState: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        state: z.nativeEnum(BenefitYearState),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const by = await loadBenefitYear(ctx.tenantId, input.id);

      const reason = rejectTransition(by.state, input.state);
      if (reason) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: reason });
      }

      // Role gate: only admin roles can publish or archive a published year.
      const movingToPublishedOrArchivingPublished =
        input.state === BenefitYearState.PUBLISHED ||
        (by.state === BenefitYearState.PUBLISHED && input.state === BenefitYearState.ARCHIVED);
      if (movingToPublishedOrArchivingPublished) {
        const role = await loadCallerRole(ctx.db, ctx.userId);
        if (!PUBLISH_ROLES.has(role)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only tenant or broker admins can publish or archive a published year.',
          });
        }
      }

      const becomingPublished =
        by.state === BenefitYearState.DRAFT && input.state === BenefitYearState.PUBLISHED;

      return prisma.benefitYear.update({
        where: { id: input.id },
        data: {
          state: input.state,
          ...(becomingPublished ? { publishedAt: new Date(), publishedBy: ctx.userId } : {}),
        },
      });
    }),
});
