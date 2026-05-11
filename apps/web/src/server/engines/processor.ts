import type { Prisma, PrismaClient } from '@prisma/client';
import type { TenantDb } from '../db/tenant';
import { classifyEmployee } from './classify-employee';
import { countActiveDependents, resolveFlexWallet } from './engine-flex';
import {
  type ClassOverrideLookup,
  type InsurancePlanRuleLookup,
  type NationalityOverrideLookup,
  resolveInsurancePlans,
} from './engine-insurance';
import { resolveParticipationType } from './engine-participation';
import type { ProcessingResult, StandardBand } from './types';

type ProcessOptions = {
  employeeIds?: string[];
  dryRun?: boolean;
};

type RuleTables = {
  gradeMap: ReadonlyMap<string, StandardBand>;
  salaryBands: ReadonlyArray<{
    minSalary: number;
    maxSalary: number | null;
    standardBand: StandardBand;
  }>;
  classOverrides: ClassOverrideLookup;
  nationalityOverrides: NationalityOverrideLookup;
  insurancePlanRules: InsurancePlanRuleLookup;
  flexRules: ReadonlyMap<string, { creditAmount: number; tierLabel: string }>;
  productIds: string[];
  childMaxAge: number;
};

export async function loadRuleTables(
  prisma: PrismaClient | TenantDb,
  benefitYearId: string,
): Promise<RuleTables> {
  const db = prisma as PrismaClient;

  const [gradeRows, salaryRows, classRows, natRows, planRuleRows, flexRows, products, benefitYear] =
    await Promise.all([
      db.gradeNormalisationMap.findMany({ where: { benefitYearId } }),
      db.salaryBandRule.findMany({ where: { benefitYearId }, orderBy: { minSalary: 'asc' } }),
      db.employmentClassPlanOverride.findMany({ where: { benefitYearId } }),
      db.nationalityPlanOverride.findMany({ where: { benefitYearId } }),
      db.insurancePlanRule.findMany({ where: { benefitYearId } }),
      db.flexWalletRule.findMany({ where: { benefitYearId } }),
      db.product.findMany({ where: { benefitYearId }, select: { id: true } }),
      db.benefitYear.findFirst({
        where: { id: benefitYearId },
        select: { policy: { select: { childMaxAge: true } } },
      }),
    ]);

  const gradeMap = new Map<string, StandardBand>();
  for (const row of gradeRows) {
    gradeMap.set(row.gradeCode, row.standardBand as StandardBand);
  }

  const salaryBands = salaryRows.map((r) => ({
    minSalary: Number(r.minSalary),
    maxSalary: r.maxSalary ? Number(r.maxSalary) : null,
    standardBand: r.standardBand as StandardBand,
  }));

  const classOverrides: Map<
    string,
    { planId: string; gbtEligible: boolean; dependantEligible: boolean }
  > = new Map();
  for (const row of classRows) {
    classOverrides.set(`${row.employmentClass}:${row.employmentType}:${row.productId}`, {
      planId: row.planId,
      gbtEligible: row.gbtEligible,
      dependantEligible: row.dependantEligible,
    });
  }

  const nationalityOverrides: Map<string, { planId: string }> = new Map();
  for (const row of natRows) {
    nationalityOverrides.set(`${row.nationality}:${row.standardBand}:${row.productId}`, {
      planId: row.planId,
    });
  }

  const insurancePlanRules: Map<
    string,
    { planId: string; gmmBundled: boolean; gbtEligible: boolean }
  > = new Map();
  for (const row of planRuleRows) {
    insurancePlanRules.set(`${row.standardBand}:${row.employmentType}:${row.productId}`, {
      planId: row.planId,
      gmmBundled: row.gmmBundled,
      gbtEligible: row.gbtEligible,
    });
  }

  const flexRules: Map<string, { creditAmount: number; tierLabel: string }> = new Map();
  for (const row of flexRows) {
    flexRules.set(row.flexTierKey, {
      creditAmount: Number(row.creditAmount),
      tierLabel: row.tierLabel,
    });
  }

  return {
    gradeMap,
    salaryBands,
    classOverrides,
    nationalityOverrides,
    insurancePlanRules,
    flexRules,
    productIds: products.map((p) => p.id),
    childMaxAge: benefitYear?.policy?.childMaxAge ?? 21,
  };
}

export async function processEmployeeBenefits(
  prisma: PrismaClient | TenantDb,
  tenantId: string,
  benefitYearId: string,
  clientId: string,
  options: ProcessOptions = {},
): Promise<ProcessingResult> {
  const db = prisma as PrismaClient;
  const rules = await loadRuleTables(db, benefitYearId);

  const employeeWhere: Record<string, unknown> = { clientId, status: 'ACTIVE' };
  if (options.employeeIds?.length) {
    employeeWhere.id = { in: options.employeeIds };
  }

  const employees = await db.employee.findMany({
    where: employeeWhere,
    include: { dependents: true },
  });

  const result: ProcessingResult = {
    total: employees.length,
    resolved: 0,
    errors: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    engineBreakdown: {
      insurance: { resolved: 0, errors: 0 },
      flex: { resolved: 0, errors: 0 },
    },
  };

  const enrollmentsToWrite: Array<{
    employeeId: string;
    productId: string;
    planId: string;
    coverTier: string;
    resolutionPath: string;
    effectiveFrom: Date;
  }> = [];

  const errorsToWrite: Array<{
    tenantId: string;
    benefitYearId: string;
    employeeId: string;
    engine: string;
    errorCode: string;
    errorMessage: string;
    employeeSnapshot: Prisma.InputJsonValue;
  }> = [];

  for (const employee of employees) {
    const data = employee.data as Record<string, unknown>;
    const classification = classifyEmployee(data, rules.gradeMap, rules.salaryBands);

    const counts = countActiveDependents(employee.dependents, rules.childMaxAge);
    const maritalStatus = data['employee.marital_status'] as string | null | undefined;
    const nationality = data['employee.nationality'] as string | null | undefined;

    const flexResult = resolveFlexWallet(
      employee.id,
      classification.employmentType,
      maritalStatus,
      counts,
      rules.flexRules,
    );

    if (flexResult.error) {
      result.engineBreakdown.flex.errors++;
      errorsToWrite.push({
        tenantId,
        benefitYearId,
        employeeId: employee.id,
        engine: 'FLEX_WALLET',
        errorCode: flexResult.error.code,
        errorMessage: flexResult.error.message,
        employeeSnapshot: data as Prisma.InputJsonValue,
      });
    } else {
      result.engineBreakdown.flex.resolved++;
    }

    const planResults = resolveInsurancePlans(
      employee.id,
      classification,
      nationality,
      rules.productIds,
      rules.classOverrides,
      rules.nationalityOverrides,
      rules.insurancePlanRules,
    );

    let hasInsuranceError = false;
    for (const planRes of planResults) {
      if (planRes.error) {
        hasInsuranceError = true;
        result.engineBreakdown.insurance.errors++;
        errorsToWrite.push({
          tenantId,
          benefitYearId,
          employeeId: employee.id,
          engine: 'INSURANCE_PLAN',
          errorCode: planRes.error.code,
          errorMessage: planRes.error.message,
          employeeSnapshot: data as Prisma.InputJsonValue,
        });
        continue;
      }

      if (!planRes.resolvedPlanId) continue;
      if (!planRes.gbtEligible) continue;

      result.engineBreakdown.insurance.resolved++;

      const classKey = classification.employmentClass
        ? `${classification.employmentClass}:${classification.employmentType}:${planRes.productId}`
        : null;
      const classOverride = classKey ? rules.classOverrides.get(classKey) : null;
      const dependantEligible = classOverride ? classOverride.dependantEligible : true;

      const coverTier = resolveParticipationType({
        counts,
        dependantEligible,
      });

      enrollmentsToWrite.push({
        employeeId: employee.id,
        productId: planRes.productId,
        planId: planRes.resolvedPlanId,
        coverTier,
        resolutionPath: planRes.resolutionPath ?? 'band_rule',
        effectiveFrom: new Date(),
      });
    }

    if (hasInsuranceError || flexResult.error) {
      result.errors++;
    } else {
      result.resolved++;
    }
  }

  if (!options.dryRun) {
    const processedEmployeeIds = [...new Set(employees.map((e) => e.id))];

    const existingEnrollments =
      enrollmentsToWrite.length > 0
        ? await db.enrollment.findMany({
            where: {
              employeeId: { in: processedEmployeeIds },
              effectiveTo: null,
            },
            select: { id: true, employeeId: true, productId: true },
          })
        : [];
    const existingByKey = new Map(
      existingEnrollments.map((e) => [`${e.employeeId}:${e.productId}`, e.id]),
    );

    await db.$transaction(async (tx) => {
      await tx.processingError.deleteMany({
        where: { benefitYearId, status: 'OPEN', employeeId: { in: processedEmployeeIds } },
      });
      if (errorsToWrite.length > 0) {
        await tx.processingError.createMany({ data: errorsToWrite });
      }

      const toCreate = enrollmentsToWrite.filter(
        (e) => !existingByKey.has(`${e.employeeId}:${e.productId}`),
      );
      const toUpdate = enrollmentsToWrite.filter((e) =>
        existingByKey.has(`${e.employeeId}:${e.productId}`),
      );

      if (toCreate.length > 0) {
        await tx.enrollment.createMany({ data: toCreate });
        result.created += toCreate.length;
      }
      if (toUpdate.length > 0) {
        await Promise.all(
          toUpdate.map((e) => {
            const existingId = existingByKey.get(`${e.employeeId}:${e.productId}`);
            if (!existingId) return;
            return tx.enrollment.update({
              where: { id: existingId },
              data: {
                planId: e.planId,
                coverTier: e.coverTier,
                resolutionPath: e.resolutionPath,
              },
            });
          }),
        );
        result.updated += toUpdate.length;
      }
    });
  }

  return result;
}
