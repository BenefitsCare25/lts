// =============================================================
// Benefit groups router (S18 — Predicate builder, Screen 4).
//
// A BenefitGroup attaches a JSONLogic predicate to a Policy. The
// predicate evaluates against an Employee's `data` JSONB and decides
// whether the employee is eligible for a given product/plan
// (combined later with the eligibility matrix at S23).
//
// Tenant gate: BenefitGroup is reached through Policy → Client.
// Same defence-in-depth pattern as policies/benefit-years.
//
// JSONLogic shape: validated structurally (must be an object that
// json-logic-js can compile). Semantic validation against the
// EmployeeSchema (field exists, operator matches type, value within
// bounds) is enforced client-side at build time. The server keeps
// the predicate opaque so future schema changes don't invalidate
// stored predicates.
// =============================================================

import { prisma } from '@/server/db/client';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import jsonLogic from 'json-logic-js';
import { z } from 'zod';
import { router, tenantProcedure } from '../init';

// JSONLogic accepts any plain object/array structure that compiles.
// Reject scalars and arrays (an isolated value isn't a predicate).
// Empty object also rejected so we don't store no-op groups.
const predicateSchema = z.unknown().superRefine((val, ctx) => {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Predicate must be a JSONLogic object.',
    });
    return;
  }
  if (Object.keys(val as Record<string, unknown>).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Predicate cannot be empty — add at least one condition.',
    });
    return;
  }
  // Compile-check: jsonLogic.apply throws on malformed structures.
  // We invoke against an empty data object; the goal is structural
  // validity, not a true/false answer.
  try {
    jsonLogic.apply(val as jsonLogic.RulesLogic, {});
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid JSONLogic: ${err instanceof Error ? err.message : 'parse failed'}`,
    });
  }
});

const benefitGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null)),
  predicate: predicateSchema,
});

async function assertPolicy(tenantId: string, policyId: string): Promise<void> {
  const policy = await prisma.policy.findFirst({
    where: { id: policyId, client: { tenantId } },
    select: { id: true },
  });
  if (!policy) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
  }
}

async function loadBenefitGroup(tenantId: string, id: string) {
  const bg = await prisma.benefitGroup.findFirst({
    where: { id, policy: { client: { tenantId } } },
    select: { id: true, policyId: true },
  });
  if (!bg) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Benefit group not found.' });
  }
  return bg;
}

export const benefitGroupsRouter = router({
  listByPolicy: tenantProcedure
    .input(z.object({ policyId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertPolicy(ctx.tenantId, input.policyId);
      return prisma.benefitGroup.findMany({
        where: { policyId: input.policyId },
        orderBy: { name: 'asc' },
      });
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const bg = await prisma.benefitGroup.findFirst({
      where: { id: input.id, policy: { client: { tenantId: ctx.tenantId } } },
      include: {
        policy: { select: { id: true, name: true, clientId: true } },
      },
    });
    if (!bg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Benefit group not found.' });
    return bg;
  }),

  create: tenantProcedure
    .input(z.object({ policyId: z.string().min(1), data: benefitGroupInputSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertPolicy(ctx.tenantId, input.policyId);
      return prisma.benefitGroup.create({
        data: {
          policyId: input.policyId,
          name: input.data.name,
          description: input.data.description,
          predicate: input.data.predicate as Prisma.InputJsonValue,
        },
      });
    }),

  update: tenantProcedure
    .input(z.object({ id: z.string().min(1), data: benefitGroupInputSchema }))
    .mutation(async ({ ctx, input }) => {
      await loadBenefitGroup(ctx.tenantId, input.id);
      return prisma.benefitGroup.update({
        where: { id: input.id },
        data: {
          name: input.data.name,
          description: input.data.description,
          predicate: input.data.predicate as Prisma.InputJsonValue,
        },
      });
    }),

  delete: tenantProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await loadBenefitGroup(ctx.tenantId, input.id);
      try {
        await prisma.benefitGroup.delete({ where: { id: input.id } });
        return { id: input.id };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError) {
          if (err.code === 'P2025') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Benefit group not found.' });
          }
          if (err.code === 'P2003') {
            throw new TRPCError({
              code: 'CONFLICT',
              message:
                'Cannot delete: this group is referenced by product eligibility rules. Remove the eligibility rows first.',
            });
          }
        }
        throw err;
      }
    }),
});
