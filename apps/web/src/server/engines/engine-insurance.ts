import type { EmployeeClassification, PlanResolution } from './types';

export type InsurancePlanRuleLookup = ReadonlyMap<
  string, // key: `${standardBand}:${employmentType}:${productId}`
  { planId: string; gmmBundled: boolean; gbtEligible: boolean }
>;

export type ClassOverrideLookup = ReadonlyMap<
  string, // key: `${employmentClass}:${employmentType}:${productId}`
  { planId: string; gbtEligible: boolean; dependantEligible: boolean }
>;

export type NationalityOverrideLookup = ReadonlyMap<
  string, // key: `${nationality}:${standardBand}:${productId}`
  { planId: string }
>;

export function resolveInsurancePlans(
  employeeId: string,
  classification: EmployeeClassification,
  nationality: string | null | undefined,
  productIds: ReadonlyArray<string>,
  classOverrides: ClassOverrideLookup,
  nationalityOverrides: NationalityOverrideLookup,
  insurancePlanRules: InsurancePlanRuleLookup,
): PlanResolution[] {
  const results: PlanResolution[] = [];

  for (const productId of productIds) {
    const resolution = resolveForProduct(
      employeeId,
      classification,
      nationality,
      productId,
      classOverrides,
      nationalityOverrides,
      insurancePlanRules,
    );
    results.push(resolution);
  }

  return results;
}

function resolveForProduct(
  employeeId: string,
  classification: EmployeeClassification,
  nationality: string | null | undefined,
  productId: string,
  classOverrides: ClassOverrideLookup,
  nationalityOverrides: NationalityOverrideLookup,
  insurancePlanRules: InsurancePlanRuleLookup,
): PlanResolution {
  const { employmentType, isOverrideClass, employmentClass, standardBand } = classification;

  if (isOverrideClass && employmentClass) {
    const key = `${employmentClass}:${employmentType}:${productId}`;
    const override = classOverrides.get(key);
    if (override) {
      return {
        employeeId,
        productId,
        resolvedPlanId: override.planId,
        coverTier: null,
        resolutionPath: 'class_override',
        gmmBundled: false,
        gbtEligible: override.gbtEligible,
      };
    }
    return {
      employeeId,
      productId,
      resolvedPlanId: null,
      coverTier: null,
      resolutionPath: null,
      gmmBundled: false,
      gbtEligible: false,
      error: {
        code: 'NO_CLASS_OVERRIDE',
        message: `No override for class "${employmentClass}" + type "${employmentType}" on product "${productId}"`,
      },
    };
  }

  if (classification.error) {
    return {
      employeeId,
      productId,
      resolvedPlanId: null,
      coverTier: null,
      resolutionPath: null,
      gmmBundled: false,
      gbtEligible: false,
      error: classification.error,
    };
  }

  if (!standardBand) {
    return {
      employeeId,
      productId,
      resolvedPlanId: null,
      coverTier: null,
      resolutionPath: null,
      gmmBundled: false,
      gbtEligible: false,
      error: { code: 'MISSING_GRADE', message: 'Standard band not resolved' },
    };
  }

  if (nationality) {
    const natKey = `${nationality}:${standardBand}:${productId}`;
    const natOverride = nationalityOverrides.get(natKey);
    if (natOverride) {
      return {
        employeeId,
        productId,
        resolvedPlanId: natOverride.planId,
        coverTier: null,
        resolutionPath: 'nationality_override',
        gmmBundled: false,
        gbtEligible: true,
      };
    }
  }

  const ruleKey = `${standardBand}:${employmentType}:${productId}`;
  const rule = insurancePlanRules.get(ruleKey);
  if (rule) {
    return {
      employeeId,
      productId,
      resolvedPlanId: rule.planId,
      coverTier: null,
      resolutionPath: 'band_rule',
      gmmBundled: rule.gmmBundled,
      gbtEligible: rule.gbtEligible,
    };
  }

  return {
    employeeId,
    productId,
    resolvedPlanId: null,
    coverTier: null,
    resolutionPath: null,
    gmmBundled: false,
    gbtEligible: false,
    error: {
      code: 'NO_PLAN_RULE',
      message: `No rule for band "${standardBand}" + type "${employmentType}" on product "${productId}"`,
    },
  };
}
