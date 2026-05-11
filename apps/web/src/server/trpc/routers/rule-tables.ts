import { processEmployeeBenefits } from '@/server/engines/processor';
import { EMPLOYMENT_TYPES, STANDARD_BANDS } from '@/server/engines/types';
import { processDependentUpload } from '@/server/ingestion/dependent-upload';
import { processEmployeeUpload } from '@/server/ingestion/employee-upload';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

const byBenefitYearInput = z.object({ benefitYearId: z.string().min(1) });

const bandEnum = z.enum(STANDARD_BANDS);
const empTypeEnum = z.enum(EMPLOYMENT_TYPES);

const gradeMapRowSchema = z.object({
  gradeCode: z.string().trim().min(1).max(50),
  standardBand: bandEnum,
});

const salaryBandRowSchema = z.object({
  minSalary: z.number().nonnegative(),
  maxSalary: z.number().nonnegative().nullable(),
  standardBand: bandEnum,
});

const insurancePlanRuleRowSchema = z.object({
  standardBand: bandEnum,
  employmentType: empTypeEnum,
  productId: z.string().min(1),
  planId: z.string().min(1),
  gmmBundled: z.boolean().default(false),
  gbtEligible: z.boolean().default(true),
});

const classOverrideRowSchema = z.object({
  employmentClass: z.string().trim().min(1),
  employmentType: empTypeEnum,
  productId: z.string().min(1),
  planId: z.string().min(1),
  gbtEligible: z.boolean().default(true),
  dependantEligible: z.boolean().default(false),
});

const nationalityOverrideRowSchema = z.object({
  nationality: z.string().trim().min(1).max(10),
  standardBand: bandEnum,
  productId: z.string().min(1),
  planId: z.string().min(1),
});

const flexWalletRuleRowSchema = z.object({
  flexTierKey: z.string().trim().min(1),
  creditAmount: z.number().nonnegative(),
  tierLabel: z.string().trim().min(1),
  currencyCode: z.string().default('SGD'),
});

const processingErrorFilterSchema = z.object({
  benefitYearId: z.string().min(1),
  status: z.enum(['OPEN', 'RESOLVED', 'IGNORED']).optional(),
  engine: z.string().optional(),
  errorCode: z.string().optional(),
});

function db(ctx: { db: unknown }): PrismaClient {
  return ctx.db as PrismaClient;
}

export const ruleTablesRouter = router({
  gradeMap: router({
    list: tenantProcedure.input(byBenefitYearInput).query(({ ctx, input }) =>
      db(ctx).gradeNormalisationMap.findMany({
        where: { benefitYearId: input.benefitYearId },
        orderBy: { gradeCode: 'asc' },
      }),
    ),

    upsertBatch: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          rows: z.array(gradeMapRowSchema).max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db(ctx).gradeNormalisationMap.deleteMany({
          where: { benefitYearId: input.benefitYearId },
        });
        if (input.rows.length > 0) {
          await db(ctx).gradeNormalisationMap.createMany({
            data: input.rows.map((r) => ({
              benefitYearId: input.benefitYearId,
              gradeCode: r.gradeCode,
              standardBand: r.standardBand,
            })),
          });
        }
        return { count: input.rows.length };
      }),
  }),

  salaryBands: router({
    list: tenantProcedure.input(byBenefitYearInput).query(({ ctx, input }) =>
      db(ctx).salaryBandRule.findMany({
        where: { benefitYearId: input.benefitYearId },
        orderBy: { minSalary: 'asc' },
      }),
    ),

    upsertBatch: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          rows: z.array(salaryBandRowSchema).max(50),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db(ctx).salaryBandRule.deleteMany({
          where: { benefitYearId: input.benefitYearId },
        });
        if (input.rows.length > 0) {
          await db(ctx).salaryBandRule.createMany({
            data: input.rows.map((r) => ({
              benefitYearId: input.benefitYearId,
              minSalary: r.minSalary,
              maxSalary: r.maxSalary,
              standardBand: r.standardBand,
            })),
          });
        }
        return { count: input.rows.length };
      }),
  }),

  insurancePlanRules: router({
    list: tenantProcedure.input(byBenefitYearInput).query(({ ctx, input }) =>
      db(ctx).insurancePlanRule.findMany({
        where: { benefitYearId: input.benefitYearId },
        orderBy: [{ standardBand: 'asc' }, { employmentType: 'asc' }],
      }),
    ),

    upsertBatch: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          rows: z.array(insurancePlanRuleRowSchema).max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db(ctx).insurancePlanRule.deleteMany({
          where: { benefitYearId: input.benefitYearId },
        });
        if (input.rows.length > 0) {
          await db(ctx).insurancePlanRule.createMany({
            data: input.rows.map((r) => ({
              benefitYearId: input.benefitYearId,
              standardBand: r.standardBand,
              employmentType: r.employmentType,
              productId: r.productId,
              planId: r.planId,
              gmmBundled: r.gmmBundled,
              gbtEligible: r.gbtEligible,
            })),
          });
        }
        return { count: input.rows.length };
      }),
  }),

  classOverrides: router({
    list: tenantProcedure.input(byBenefitYearInput).query(({ ctx, input }) =>
      db(ctx).employmentClassPlanOverride.findMany({
        where: { benefitYearId: input.benefitYearId },
        orderBy: [{ employmentClass: 'asc' }, { employmentType: 'asc' }],
      }),
    ),

    upsertBatch: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          rows: z.array(classOverrideRowSchema).max(100),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db(ctx).employmentClassPlanOverride.deleteMany({
          where: { benefitYearId: input.benefitYearId },
        });
        if (input.rows.length > 0) {
          await db(ctx).employmentClassPlanOverride.createMany({
            data: input.rows.map((r) => ({
              benefitYearId: input.benefitYearId,
              employmentClass: r.employmentClass,
              employmentType: r.employmentType,
              productId: r.productId,
              planId: r.planId,
              gbtEligible: r.gbtEligible,
              dependantEligible: r.dependantEligible,
            })),
          });
        }
        return { count: input.rows.length };
      }),
  }),

  nationalityOverrides: router({
    list: tenantProcedure.input(byBenefitYearInput).query(({ ctx, input }) =>
      db(ctx).nationalityPlanOverride.findMany({
        where: { benefitYearId: input.benefitYearId },
        orderBy: [{ nationality: 'asc' }, { standardBand: 'asc' }],
      }),
    ),

    upsertBatch: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          rows: z.array(nationalityOverrideRowSchema).max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db(ctx).nationalityPlanOverride.deleteMany({
          where: { benefitYearId: input.benefitYearId },
        });
        if (input.rows.length > 0) {
          await db(ctx).nationalityPlanOverride.createMany({
            data: input.rows.map((r) => ({
              benefitYearId: input.benefitYearId,
              nationality: r.nationality,
              standardBand: r.standardBand,
              productId: r.productId,
              planId: r.planId,
            })),
          });
        }
        return { count: input.rows.length };
      }),
  }),

  flexWalletRules: router({
    list: tenantProcedure.input(byBenefitYearInput).query(({ ctx, input }) =>
      db(ctx).flexWalletRule.findMany({
        where: { benefitYearId: input.benefitYearId },
        orderBy: { flexTierKey: 'asc' },
      }),
    ),

    upsertBatch: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          rows: z.array(flexWalletRuleRowSchema).max(30),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db(ctx).flexWalletRule.deleteMany({
          where: { benefitYearId: input.benefitYearId },
        });
        if (input.rows.length > 0) {
          await db(ctx).flexWalletRule.createMany({
            data: input.rows.map((r) => ({
              benefitYearId: input.benefitYearId,
              flexTierKey: r.flexTierKey,
              creditAmount: r.creditAmount,
              tierLabel: r.tierLabel,
              currencyCode: r.currencyCode,
            })),
          });
        }
        return { count: input.rows.length };
      }),
  }),

  processingErrors: router({
    list: tenantProcedure.input(processingErrorFilterSchema).query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        benefitYearId: input.benefitYearId,
        tenantId: ctx.tenantId,
      };
      if (input.status) where.status = input.status;
      if (input.engine) where.engine = input.engine;
      if (input.errorCode) where.errorCode = input.errorCode;

      return db(ctx).processingError.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    }),

    resolve: adminProcedure
      .input(z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }))
      .mutation(({ ctx, input }) =>
        db(ctx).processingError.updateMany({
          where: { id: { in: input.ids }, tenantId: ctx.tenantId },
          data: { status: 'RESOLVED', resolvedBy: ctx.userId, resolvedAt: new Date() },
        }),
      ),

    ignore: adminProcedure
      .input(z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }))
      .mutation(({ ctx, input }) =>
        db(ctx).processingError.updateMany({
          where: { id: { in: input.ids }, tenantId: ctx.tenantId },
          data: { status: 'IGNORED', resolvedBy: ctx.userId, resolvedAt: new Date() },
        }),
      ),
  }),

  engine: router({
    processBenefitYear: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          clientId: z.string().min(1),
        }),
      )
      .mutation(({ ctx, input }) =>
        processEmployeeBenefits(db(ctx), ctx.tenantId, input.benefitYearId, input.clientId),
      ),

    processEmployee: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          clientId: z.string().min(1),
          employeeId: z.string().min(1),
        }),
      )
      .mutation(({ ctx, input }) =>
        processEmployeeBenefits(db(ctx), ctx.tenantId, input.benefitYearId, input.clientId, {
          employeeIds: [input.employeeId],
        }),
      ),

    dryRun: adminProcedure
      .input(
        z.object({
          benefitYearId: z.string().min(1),
          clientId: z.string().min(1),
        }),
      )
      .mutation(({ ctx, input }) =>
        processEmployeeBenefits(db(ctx), ctx.tenantId, input.benefitYearId, input.clientId, {
          dryRun: true,
        }),
      ),

    uploadEmployees: adminProcedure
      .input(
        z.object({
          clientId: z.string().min(1),
          fileBase64: z.string().min(1),
        }),
      )
      .mutation(({ ctx, input }) => {
        const buf = Buffer.from(input.fileBase64, 'base64');
        const arrayBuffer = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer;
        return processEmployeeUpload(db(ctx), input.clientId, arrayBuffer);
      }),

    uploadDependents: adminProcedure
      .input(
        z.object({
          clientId: z.string().min(1),
          fileBase64: z.string().min(1),
        }),
      )
      .mutation(({ ctx, input }) => {
        const buf = Buffer.from(input.fileBase64, 'base64');
        const arrayBuffer = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer;
        return processDependentUpload(db(ctx), input.clientId, arrayBuffer);
      }),
  }),
});
