import { fieldToPropSchema } from '@/server/catalogue/employee-field-schema';
import { safeCompile } from '@/server/catalogue/ajv';
import { prisma } from '@/server/db/client';
import type { EmployeeField } from '@insurance-saas/shared-types';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { portalProcedure, router } from '../init';

// Uses raw prisma (not ctx.db) because Enrollment/Product/Plan/etc. are not
// in TENANT_MODELS; RLS on Employee provides the isolation guarantee.
async function fetchEntitlements(_tenantId: string, employeeId: string) {
  const enrollments = await prisma.enrollment.findMany({
    where: { employeeId, effectiveTo: null },
  });
  if (enrollments.length === 0) return [];

  const productIds = [...new Set(enrollments.map((e) => e.productId))];
  const planIds = [...new Set(enrollments.map((e) => e.planId))];
  const groupIds = [...new Set(enrollments.map((e) => e.benefitGroupId))];

  const [products, plans, groups, rates] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        productType: {
          select: { code: true, name: true, displayTemplate: true },
        },
      },
    }),
    prisma.plan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, code: true, name: true, coverBasis: true, schedule: true },
    }),
    prisma.benefitGroup.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, name: true },
    }),
    prisma.premiumRate.findMany({
      where: { planId: { in: planIds } },
      select: { planId: true, coverTier: true, ratePerThousand: true, fixedAmount: true },
    }),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const rateByKey = new Map(rates.map((r) => [`${r.planId}:${r.coverTier ?? '*'}`, r]));

  return enrollments.map((enr) => {
    const product = productById.get(enr.productId);
    const plan = planById.get(enr.planId);
    const group = groupById.get(enr.benefitGroupId);
    const matchingRate =
      rateByKey.get(`${enr.planId}:${enr.coverTier}`) ??
      rateByKey.get(`${enr.planId}:*`) ??
      null;

    return {
      enrollmentId: enr.id,
      productTypeCode: product?.productType?.code ?? null,
      productTypeName: product?.productType?.name ?? null,
      displayTemplate: product?.productType?.displayTemplate ?? null,
      planCode: plan?.code ?? null,
      planName: plan?.name ?? null,
      coverBasis: plan?.coverBasis ?? null,
      schedule: plan?.schedule ?? null,
      benefitGroupName: group?.name ?? null,
      coverTier: enr.coverTier,
      effectiveFrom: enr.effectiveFrom,
      rate: matchingRate
        ? {
            ratePerThousand: matchingRate.ratePerThousand?.toNumber() ?? null,
            fixedAmount: matchingRate.fixedAmount?.toNumber() ?? null,
          }
        : null,
    };
  });
}

// Partial-update schema: only editable fields, no required array.
function editableFieldsToSchema(fields: EmployeeField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of fields.filter((field) => field.employeeEditable)) {
    properties[f.name] = fieldToPropSchema(f);
  }
  return { type: 'object', properties, additionalProperties: false };
}

// ─── Sub-routers ─────────────────────────────────────────────────

const benefitsRouter = router({
  list: portalProcedure.query(async ({ ctx }) => {
    return fetchEntitlements(ctx.tenantId, ctx.employeeId);
  }),

  detail: portalProcedure
    .input(z.object({ enrollmentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await fetchEntitlements(ctx.tenantId, ctx.employeeId);
      const row = rows.find((r) => r.enrollmentId === input.enrollmentId);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Enrollment not found.' });
      return row;
    }),
});

const profileRouter = router({
  get: portalProcedure.query(async ({ ctx }) => {
    const [employee, schema] = await Promise.all([
      prisma.employee.findFirst({
        where: { id: ctx.employeeId, client: { tenantId: ctx.tenantId } },
        select: { id: true, data: true, status: true, hireDate: true, terminationDate: true },
      }),
      prisma.employeeSchema.findUnique({
        where: { tenantId: ctx.tenantId },
        select: { fields: true },
      }),
    ]);
    if (!employee) throw new TRPCError({ code: 'NOT_FOUND', message: 'Employee not found.' });
    return { ...employee, schema: schema?.fields ?? null };
  }),

  update: portalProcedure
    .input(z.object({ data: z.record(z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const schema = await prisma.employeeSchema.findUnique({
        where: { tenantId: ctx.tenantId },
        select: { fields: true },
      });
      const fields = (schema?.fields as EmployeeField[] | null) ?? [];
      const editableNames = new Set(fields.filter((f) => f.employeeEditable).map((f) => f.name));

      const sanitised: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input.data)) {
        if (editableNames.has(k)) sanitised[k] = v;
      }

      if (editableNames.size > 0 && Object.keys(sanitised).length > 0) {
        const compiled = safeCompile(
          editableFieldsToSchema(fields),
          `portal-profile:${ctx.tenantId}`,
        );
        if (!compiled.ok) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Schema compile error.' });
        }
        if (!compiled.validate(sanitised)) {
          const msgs = (compiled.validate.errors ?? []).map(
            (e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`,
          );
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Validation failed: ${msgs.join('; ')}`,
          });
        }
      }

      const existing = await prisma.employee.findFirst({
        where: { id: ctx.employeeId },
        select: { data: true },
      });
      const merged = { ...(existing?.data as Record<string, unknown>), ...sanitised };

      await prisma.employee.update({
        where: { id: ctx.employeeId },
        data: { data: merged as Prisma.InputJsonValue },
      });

      return { ok: true };
    }),
});

const dependentsRouter = router({
  list: portalProcedure.query(async ({ ctx }) => {
    return prisma.dependent.findMany({
      where: { employeeId: ctx.employeeId },
    });
  }),

  pendingRequests: portalProcedure.query(async ({ ctx }) => {
    return ctx.db.dependentChangeRequest.findMany({
      where: { employeeId: ctx.employeeId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }),

  requestAdd: portalProcedure
    .input(
      z.object({
        data: z.record(z.unknown()),
        relation: z.enum(['spouse', 'child', 'parent']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.dependentChangeRequest.create({
        data: {
          tenantId: ctx.tenantId,
          employeeId: ctx.employeeId,
          action: 'ADD',
          data: input.data,
          relation: input.relation,
        },
      });
    }),

  requestEdit: portalProcedure
    .input(
      z.object({
        dependentId: z.string(),
        data: z.record(z.unknown()),
        relation: z.enum(['spouse', 'child', 'parent']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.dependent.findFirst({
        where: { id: input.dependentId, employeeId: ctx.employeeId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dependent not found.' });

      return ctx.db.dependentChangeRequest.create({
        data: {
          tenantId: ctx.tenantId,
          employeeId: ctx.employeeId,
          action: 'EDIT',
          dependentId: input.dependentId,
          data: input.data,
          relation: input.relation,
        },
      });
    }),

  requestRemove: portalProcedure
    .input(z.object({ dependentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.dependent.findFirst({
        where: { id: input.dependentId, employeeId: ctx.employeeId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dependent not found.' });

      return ctx.db.dependentChangeRequest.create({
        data: {
          tenantId: ctx.tenantId,
          employeeId: ctx.employeeId,
          action: 'REMOVE',
          dependentId: input.dependentId,
          data: existing.data as Record<string, unknown>,
          relation: existing.relation,
        },
      });
    }),
});

// ─── Root portal router ───────────────────────────────────────────

export const portalRouter = router({
  dashboard: portalProcedure.query(async ({ ctx }) => {
    const [enrollmentCount, pendingRequestCount] = await Promise.all([
      prisma.enrollment.count({ where: { employeeId: ctx.employeeId, effectiveTo: null } }),
      ctx.db.dependentChangeRequest.count({
        where: { employeeId: ctx.employeeId, status: 'PENDING' },
      }),
    ]);
    return { enrollmentCount, pendingRequestCount };
  }),

  benefits: benefitsRouter,
  profile: profileRouter,
  dependents: dependentsRouter,
});
