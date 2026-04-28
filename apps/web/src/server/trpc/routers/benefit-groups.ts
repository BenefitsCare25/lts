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

  // S19: live employee-match preview. Counts how many Employee.data
  // rows under the given client satisfy the provided JSONLogic predicate.
  // The predicate is structurally validated (compile-check) but otherwise
  // opaque — same trust model as create/update, since the goal is to
  // evaluate exactly what the user is about to save.
  evaluate: tenantProcedure
    .input(
      z.object({
        policyId: z.string().min(1),
        predicate: predicateSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      // Resolve the policy's clientId after asserting tenant scope.
      const policy = await prisma.policy.findFirst({
        where: { id: input.policyId, client: { tenantId: ctx.tenantId } },
        select: { id: true, clientId: true },
      });
      if (!policy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
      }

      // Pull every employee on the client. Phase 1's expected scale is
      // a few hundred per client at most — full scan is fine. If a real
      // tenant ever exceeds 50k employees, swap for a streaming evaluator.
      const employees = await prisma.employee.findMany({
        where: { clientId: policy.clientId },
        select: { data: true },
      });

      let matched = 0;
      for (const e of employees) {
        try {
          // jsonLogic.apply is forgiving: it returns falsy on missing
          // fields rather than throwing. We still wrap so a malformed
          // predicate that slipped past the schema check can't crash
          // the request mid-loop.
          if (jsonLogic.apply(input.predicate as jsonLogic.RulesLogic, e.data)) {
            matched += 1;
          }
        } catch {
          // Skip rows that fail evaluation; report total + matched.
        }
      }
      return { total: employees.length, matched };
    }),

  // S20: overlap detection. For each existing group on the policy
  // (excluding `excludeId` when editing), evaluate both predicates
  // against every employee and return groups with non-zero intersection.
  // Advisory only — the save mutation doesn't re-check; the UI is
  // expected to surface the warning and require user acknowledgment.
  //
  // When no employees exist, intersection counts are unknown — we still
  // return overlaps with `intersection: 0` and a `noEmployeesYet` flag
  // so the UI can warn the user that the check is best-effort. The
  // alternative (silently passing every save) is worse because the
  // overlap might really exist; the user just hasn't loaded employees.
  checkOverlap: tenantProcedure
    .input(
      z.object({
        policyId: z.string().min(1),
        predicate: predicateSchema,
        excludeId: z.string().min(1).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const policy = await prisma.policy.findFirst({
        where: { id: input.policyId, client: { tenantId: ctx.tenantId } },
        select: { id: true, clientId: true },
      });
      if (!policy) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Policy not found.' });
      }

      const [otherGroups, employees] = await Promise.all([
        prisma.benefitGroup.findMany({
          where: {
            policyId: input.policyId,
            ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
          },
          select: { id: true, name: true, predicate: true },
        }),
        prisma.employee.findMany({
          where: { clientId: policy.clientId },
          select: { data: true },
        }),
      ]);

      const candidate = input.predicate as jsonLogic.RulesLogic;
      const overlaps: { id: string; name: string; intersection: number }[] = [];

      for (const other of otherGroups) {
        let count = 0;
        for (const e of employees) {
          try {
            if (
              jsonLogic.apply(candidate, e.data) &&
              jsonLogic.apply(other.predicate as jsonLogic.RulesLogic, e.data)
            ) {
              count += 1;
            }
          } catch {
            // ignore per-row eval failures
          }
        }
        if (count > 0) {
          overlaps.push({ id: other.id, name: other.name, intersection: count });
        }
      }

      return {
        overlaps,
        otherGroupCount: otherGroups.length,
        employeeCount: employees.length,
        noEmployeesYet: employees.length === 0,
      };
    }),
});
