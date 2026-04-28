// =============================================================
// Employee Schema router (S11 — Screen 0a editor).
//
// Single-row-per-tenant: EmployeeSchema.fields is one JSON array
// containing built-in + standard + custom fields, discriminated
// by field.tier. All mutations operate on that array and bump
// the version counter so downstream consumers (the predicate
// builder, the Excel parser) can detect drift.
//
// Built-ins are immutable. Standards can only be toggled. Customs
// have full CRUD. The router enforces all three at the API level.
// =============================================================

import {
  CUSTOM_FIELD_NAME_PATTERN,
  DEFAULT_EMPLOYEE_FIELDS,
  type EmployeeField,
  FIELD_DATA_TYPES,
  type FieldTier,
} from '@insurance-saas/shared-types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

// Zod schema lives here (not shared-types) to avoid a dual-package
// zod brand collision that would erase tRPC's input type inference.
const customFieldSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(
        CUSTOM_FIELD_NAME_PATTERN,
        'Use lowercase letters, digits, underscores. Must start with `employee.`.',
      ),
    label: z.string().trim().min(1).max(80),
    type: z.enum(FIELD_DATA_TYPES),
    required: z.boolean(),
    pii: z.boolean(),
    selectableForPredicates: z.boolean(),
    enumValues: z.array(z.string().trim().min(1)).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'enum' && (!val.enumValues || val.enumValues.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enum fields need at least one allowed value.',
        path: ['enumValues'],
      });
    }
    if (
      (val.type === 'integer' || val.type === 'number') &&
      val.min !== undefined &&
      val.max !== undefined &&
      val.min > val.max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Min must be ≤ max.',
        path: ['max'],
      });
    }
  });

// Returns the existing schema row, creating it with defaults on first
// access. Cheaper than auto-seeding on tenant creation because not
// every code path needs the schema (e.g. /api/health/redis).
async function loadFields(
  // biome-ignore lint/suspicious/noExplicitAny: prisma extension type
  db: any,
  tenantId: string,
): Promise<{ id: string; version: number; fields: EmployeeField[] }> {
  const existing = await db.employeeSchema.findFirst();
  if (existing) {
    return {
      id: existing.id,
      version: existing.version,
      fields: existing.fields as EmployeeField[],
    };
  }
  const created = await db.employeeSchema.create({
    data: {
      tenantId,
      version: 1,
      fields: DEFAULT_EMPLOYEE_FIELDS,
    },
  });
  return {
    id: created.id,
    version: created.version,
    fields: created.fields as EmployeeField[],
  };
}

async function persistFields(
  // biome-ignore lint/suspicious/noExplicitAny: prisma extension type
  db: any,
  schemaId: string,
  fields: EmployeeField[],
): Promise<{ version: number; fields: EmployeeField[] }> {
  // Bump version on every save — Phase 1 doesn't yet act on the
  // version, but S33 (employee CRUD) and S18 (predicate builder)
  // will use it as a cache key.
  const updated = await db.employeeSchema.update({
    where: { id: schemaId },
    data: {
      fields,
      version: { increment: 1 },
    },
  });
  return { version: updated.version, fields: updated.fields as EmployeeField[] };
}

function findField(fields: EmployeeField[], name: string): EmployeeField | undefined {
  return fields.find((f) => f.name === name);
}

// `exactOptionalPropertyTypes: true` in tsconfig refuses to assign
// `T | undefined` where the target type uses `T?`. Strip absent
// optional keys before building the EmployeeField record.
function buildCustomField(input: z.infer<typeof customFieldSchema>): EmployeeField {
  const field: EmployeeField = {
    name: input.name,
    label: input.label,
    type: input.type,
    tier: 'CUSTOM',
    required: input.required,
    pii: input.pii,
    selectableForPredicates: input.selectableForPredicates,
  };
  if (input.enumValues !== undefined) field.enumValues = input.enumValues;
  if (input.min !== undefined) field.min = input.min;
  if (input.max !== undefined) field.max = input.max;
  return field;
}

function assertTier(field: EmployeeField | undefined, expected: FieldTier, op: string): void {
  if (!field) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found.' });
  }
  if (field.tier !== expected) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Cannot ${op} a ${field.tier.toLowerCase()} field.`,
    });
  }
}

export const employeeSchemaRouter = router({
  get: tenantProcedure.query(async ({ ctx }) => {
    return loadFields(ctx.db, ctx.tenantId);
  }),

  setStandardEnabled: adminProcedure
    .input(z.object({ name: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { id, fields } = await loadFields(ctx.db, ctx.tenantId);
      const target = findField(fields, input.name);
      assertTier(target, 'STANDARD', 'toggle');
      const next = fields.map((f) =>
        f.name === input.name ? { ...f, enabled: input.enabled } : f,
      );
      return persistFields(ctx.db, id, next);
    }),

  addCustom: adminProcedure.input(customFieldSchema).mutation(async ({ ctx, input }) => {
    const { id, fields } = await loadFields(ctx.db, ctx.tenantId);
    if (findField(fields, input.name)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `A field named "${input.name}" already exists.`,
      });
    }
    return persistFields(ctx.db, id, [...fields, buildCustomField(input)]);
  }),

  updateCustom: adminProcedure
    .input(z.object({ name: z.string().min(1), data: customFieldSchema }))
    .mutation(async ({ ctx, input }) => {
      const { id, fields } = await loadFields(ctx.db, ctx.tenantId);
      const existing = findField(fields, input.name);
      assertTier(existing, 'CUSTOM', 'edit');
      if (input.data.name !== input.name && findField(fields, input.data.name)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A field named "${input.data.name}" already exists.`,
        });
      }
      const next = fields.map((f) => (f.name === input.name ? buildCustomField(input.data) : f));
      return persistFields(ctx.db, id, next);
    }),

  removeCustom: adminProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id, fields } = await loadFields(ctx.db, ctx.tenantId);
      const target = findField(fields, input.name);
      assertTier(target, 'CUSTOM', 'remove');
      const next = fields.filter((f) => f.name !== input.name);
      return persistFields(ctx.db, id, next);
    }),
});
