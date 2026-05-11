export const STANDARD_BANDS = ['LOW', 'MID', 'HIGH', 'SENIOR', 'EXEC'] as const;
export type StandardBand = (typeof STANDARD_BANDS)[number];

export const EMPLOYMENT_TYPES = ['LOCAL', 'FW'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const OVERRIDE_CLASSES = [
  'BARGAINABLE',
  'INTERN',
  'APPRENTICE',
  'SGUNITED_TRAINEE',
] as const;
export type OverrideClass = (typeof OVERRIDE_CLASSES)[number];

export const FLEX_TIER_BASES = [
  'SINGLE',
  'SINGLE_PARENT_1',
  'SINGLE_PARENT_2',
  'MARRIED_0',
  'MARRIED_1',
  'MARRIED_2PLUS',
] as const;
export type FlexTierBase = (typeof FLEX_TIER_BASES)[number];

export type FlexTierKey = `${FlexTierBase}_${EmploymentType}`;

export const PROCESSING_ERROR_CODES = {
  MISSING_GRADE: 'No grade, salary, or band override available for this employee',
  NO_GRADE_MAP: 'Grade code not found in the grade normalisation map',
  NO_SALARY_BAND: 'Salary does not fall within any defined salary band',
  NO_PLAN_RULE: 'No insurance plan rule for this band + employment type + product',
  NO_FLEX_RULE: 'No flex wallet rule for this tier key',
  NO_CLASS_OVERRIDE:
    'No employment class override configured for this class + employment type + product',
  INVALID_EMPLOYMENT_TYPE: 'Cannot determine LOCAL/FW classification from work pass type',
} as const;

export type ProcessingErrorCode = keyof typeof PROCESSING_ERROR_CODES;

export type EmployeeClassification = {
  employmentType: EmploymentType;
  isOverrideClass: boolean;
  employmentClass: string | null;
  standardBand: StandardBand | null;
  error?: { code: ProcessingErrorCode; message: string };
};

export type FlexResolution = {
  employeeId: string;
  flexTierKey: FlexTierKey;
  creditAmount: number | null;
  tierLabel: string | null;
  error?: { code: ProcessingErrorCode; message: string };
};

export type PlanResolution = {
  employeeId: string;
  productId: string;
  resolvedPlanId: string | null;
  coverTier: string | null;
  resolutionPath: 'class_override' | 'nationality_override' | 'band_rule' | null;
  gmmBundled: boolean;
  gbtEligible: boolean;
  error?: { code: ProcessingErrorCode; message: string };
};

export type DependentCounts = {
  activeSpouse: number;
  activeChildren: number;
};

export type EngineStats = {
  resolved: number;
  errors: number;
};

export type ProcessingResult = {
  total: number;
  resolved: number;
  errors: number;
  created: number;
  updated: number;
  skipped: number;
  engineBreakdown: {
    insurance: EngineStats;
    flex: EngineStats;
  };
};
