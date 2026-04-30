// =============================================================
// Employees router (S33 + S34 — Phase 1H).
//
// Employee.data JSONB is validated against the tenant's
// EmployeeSchema. Auto-group matching: every benefit group on the
// employee's client has its predicate evaluated against the new
// employee and matching groups are returned (read-only — actual
// enrollment lands when the engagement workflow is built).
// =============================================================

import { safeCompile } from '@/server/catalogue/ajv';
import { prisma } from '@/server/db/client';
import type { TenantDb } from '@/server/db/tenant';
import type { EmployeeField } from '@insurance-saas/shared-types';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import jsonLogic from 'json-logic-js';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

// Build a JSON Schema from the tenant's EmployeeSchema fields.
// Used to validate Employee.data on every write.
function fieldsToJsonSchema(fields: EmployeeField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    if (f.tier === 'STANDARD' && f.enabled === false) continue;
    const prop: Record<string, unknown> = {};
    switch (f.type) {
      case 'string':
        prop.type = 'string';
        break;
      case 'integer':
        prop.type = 'integer';
        if (f.min !== undefined) prop.minimum = f.min;
        if (f.max !== undefined) prop.maximum = f.max;
        break;
      case 'number':
        prop.type = 'number';
        if (f.min !== undefined) prop.minimum = f.min;
        if (f.max !== undefined) prop.maximum = f.max;
        break;
      case 'boolean':
        prop.type = 'boolean';
        break;
      case 'date':
        prop.type = 'string';
        prop.format = 'date';
        break;
      case 'enum':
        prop.type = 'string';
        if (f.enumValues && f.enumValues.length > 0) prop.enum = f.enumValues;
        break;
    }
    properties[f.name] = prop;
    if (f.required && !f.computed) required.push(f.name);
  }
  return { type: 'object', properties, required };
}

async function assertClient(db: TenantDb, clientId: string) {
  const client = await db.client.findFirst({
    where: { id: clientId },
    select: { id: true },
  });
  if (!client) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found.' });
  }
}

async function loadTenantEmployeeFields(
  db: TenantDb,
): Promise<{ fields: EmployeeField[]; version: number; tenantId: string }> {
  // findFirst (rather than findUnique) so the tenant-scoped extension
  // injects tenantId — there's only ever one schema per tenant so the
  // result shape is identical.
  const schema = await db.employeeSchema.findFirst({
    select: { fields: true, version: true, tenantId: true },
  });
  if (!schema) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Tenant has no employee schema configured.',
    });
  }
  return {
    fields: (schema.fields as EmployeeField[]) ?? [],
    version: schema.version,
    tenantId: schema.tenantId,
  };
}

// Stable cache key for the Ajv compile cache. Versions increment on
// every employee-schema save (per S11), so the key changes whenever
// the schema does — no manual invalidation needed.
function employeeSchemaCacheKey(tenantId: string, version: number): string {
  return `employee-schema:${tenantId}:${version}`;
}

const employeeDataSchema = z.record(z.unknown());

const employeeInputSchema = z.object({
  data: employeeDataSchema,
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED']).default('ACTIVE'),
  hireDate: z.coerce.date(),
  terminationDate: z.coerce.date().nullable(),
});

// Evaluate every benefit group on the client against the candidate
// employee data. Returns matching groups in deterministic order.
async function matchGroupsForEmployee(
  clientId: string,
  data: Record<string, unknown>,
): Promise<{ id: string; name: string }[]> {
  const policies = await prisma.policy.findMany({
    where: { clientId },
    select: { benefitGroups: { select: { id: true, name: true, predicate: true } } },
  });
  const matches: { id: string; name: string }[] = [];
  for (const policy of policies) {
    for (const g of policy.benefitGroups) {
      try {
        if (jsonLogic.apply(g.predicate as jsonLogic.RulesLogic, data)) {
          matches.push({ id: g.id, name: g.name });
        }
      } catch {
        // Skip groups with malformed predicates.
      }
    }
  }
  return matches;
}

export const employeesRouter = router({
  listByClient: tenantProcedure
    .input(z.object({ clientId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertClient(ctx.db, input.clientId);
      const employees = await prisma.employee.findMany({
        where: { clientId: input.clientId },
        orderBy: { hireDate: 'desc' },
        select: {
          id: true,
          data: true,
          status: true,
          hireDate: true,
          terminationDate: true,
        },
      });
      return employees;
    }),

  byId: tenantProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const employee = await prisma.employee.findUnique({ where: { id: input.id } });
    if (!employee) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }
    await assertClient(ctx.db, employee.clientId);
    const matches = await matchGroupsForEmployee(
      employee.clientId,
      employee.data as Record<string, unknown>,
    );
    return { ...employee, matchedGroups: matches };
  }),

  // Returns the EmployeeSchema as a JSON Schema for @rjsf to render.
  schemaForForm: tenantProcedure.query(async ({ ctx }) => {
    const { fields } = await loadTenantEmployeeFields(ctx.db);
    return fieldsToJsonSchema(fields);
  }),

  create: adminProcedure
    .input(z.object({ clientId: z.string().min(1) }).and(employeeInputSchema))
    .mutation(async ({ ctx, input }) => {
      await assertClient(ctx.db, input.clientId);
      const { fields, version, tenantId } = await loadTenantEmployeeFields(ctx.db);
      const compiled = safeCompile(
        fieldsToJsonSchema(fields),
        employeeSchemaCacheKey(tenantId, version),
      );
      if (!compiled.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Employee schema failed to compile.',
        });
      }
      if (!compiled.validate(input.data)) {
        const messages = (compiled.validate.errors ?? []).map(
          (e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`,
        );
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Employee validation failed: ${messages.join('; ')}`,
        });
      }
      const created = await prisma.employee.create({
        data: {
          clientId: input.clientId,
          data: input.data as Prisma.InputJsonValue,
          status: input.status,
          hireDate: input.hireDate,
          terminationDate: input.terminationDate,
        },
      });
      const matches = await matchGroupsForEmployee(input.clientId, input.data);
      return { ...created, matchedGroups: matches };
    }),

  update: adminProcedure
    .input(z.object({ id: z.string().min(1) }).and(employeeInputSchema))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.employee.findUnique({ where: { id: input.id } });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Employee not found.' });
      }
      await assertClient(ctx.db, existing.clientId);
      const { fields, version, tenantId } = await loadTenantEmployeeFields(ctx.db);
      const compiled = safeCompile(
        fieldsToJsonSchema(fields),
        employeeSchemaCacheKey(tenantId, version),
      );
      if (!compiled.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Employee schema failed to compile.',
        });
      }
      if (!compiled.validate(input.data)) {
        const messages = (compiled.validate.errors ?? []).map(
          (e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`,
        );
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Employee validation failed: ${messages.join('; ')}`,
        });
      }
      return prisma.employee.update({
        where: { id: input.id },
        data: {
          data: input.data as Prisma.InputJsonValue,
          status: input.status,
          hireDate: input.hireDate,
          terminationDate: input.terminationDate,
        },
      });
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.employee.findUnique({ where: { id: input.id } });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Employee not found.' });
      }
      await assertClient(ctx.db, existing.clientId);
      await prisma.employee.delete({ where: { id: input.id } });
      return { id: input.id };
    }),

  // S34 — CSV bulk import. Caller passes parsed rows + header→field
  // map; server validates each row, creates Employee records,
  // returns successes + per-row failures so the UI can surface them.
  importCsv: adminProcedure
    .input(
      z.object({
        clientId: z.string().min(1),
        // Each row is { fieldName: value } already mapped on the client.
        // Cap at 10k rows so a malicious caller can't tie up a worker
        // with millions of validations.
        rows: z.array(z.record(z.unknown())).max(10_000),
        // The hire-date field is required for Employee.hireDate.
        hireDateField: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertClient(ctx.db, input.clientId);
      const { fields, version, tenantId } = await loadTenantEmployeeFields(ctx.db);
      const compiled = safeCompile(
        fieldsToJsonSchema(fields),
        employeeSchemaCacheKey(tenantId, version),
      );
      if (!compiled.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Employee schema failed to compile.',
        });
      }
      const validate = compiled.validate;

      const failures: { rowIndex: number; reason: string }[] = [];
      // Build the prepared row set first; only valid rows get inserted.
      const insertable: { rowIndex: number; data: Prisma.InputJsonValue; hireDate: Date }[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        if (!row) continue;
        const hireRaw = row[input.hireDateField];
        if (typeof hireRaw !== 'string' || !hireRaw) {
          failures.push({ rowIndex: i, reason: `Missing ${input.hireDateField}.` });
          continue;
        }
        const hireDate = new Date(hireRaw);
        if (Number.isNaN(hireDate.getTime())) {
          failures.push({ rowIndex: i, reason: `Invalid date in ${input.hireDateField}.` });
          continue;
        }
        if (!validate(row)) {
          const messages = (validate.errors ?? []).map(
            (e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`,
          );
          failures.push({ rowIndex: i, reason: messages.join('; ') });
          continue;
        }
        insertable.push({ rowIndex: i, data: row as Prisma.InputJsonValue, hireDate });
      }

      // Single batched write — orders of magnitude faster than per-row
      // create + lets us return a single failure on a transactional error.
      let createdCount = 0;
      if (insertable.length > 0) {
        try {
          const result = await prisma.employee.createMany({
            data: insertable.map((r) => ({
              clientId: input.clientId,
              data: r.data,
              status: 'ACTIVE',
              hireDate: r.hireDate,
            })),
            skipDuplicates: true,
          });
          createdCount = result.count;
        } catch (err) {
          // Roll the whole batch into failures so the UI can surface it.
          console.error('[employees] importCsv batch insert failed:', err);
          for (const r of insertable) {
            failures.push({
              rowIndex: r.rowIndex,
              reason: 'Batch insert failed — see server logs.',
            });
          }
        }
      }
      return { createdCount, failures };
    }),
});
