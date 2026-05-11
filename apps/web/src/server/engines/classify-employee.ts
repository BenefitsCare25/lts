import type { EmployeeClassification, EmploymentType, OverrideClass, StandardBand } from './types';
import { OVERRIDE_CLASSES, STANDARD_BANDS } from './types';

const FW_PASS_TYPES = new Set(['WORK_PERMIT', 'S_PASS', 'EP', 'DEPENDANT_PASS', 'LTVP']);

export function resolveEmploymentType(workPassType: string | null | undefined): EmploymentType {
  if (!workPassType) return 'LOCAL';
  return FW_PASS_TYPES.has(workPassType) ? 'FW' : 'LOCAL';
}

export function isOverrideEmploymentClass(employmentType: string | null | undefined): boolean {
  if (!employmentType) return false;
  return (OVERRIDE_CLASSES as readonly string[]).includes(employmentType);
}

export function resolveStandardBand(
  salaryBandOverride: string | null | undefined,
  hayJobGrade: number | string | null | undefined,
  lastDrawnSalary: number | null | undefined,
  gradeMap: ReadonlyMap<string, StandardBand>,
  salaryBands: ReadonlyArray<{
    minSalary: number;
    maxSalary: number | null;
    standardBand: StandardBand;
  }>,
): {
  band: StandardBand | null;
  error?: { code: 'MISSING_GRADE' | 'NO_GRADE_MAP' | 'NO_SALARY_BAND'; message: string };
} {
  if (salaryBandOverride && (STANDARD_BANDS as readonly string[]).includes(salaryBandOverride)) {
    return { band: salaryBandOverride as StandardBand };
  }

  if (hayJobGrade != null && hayJobGrade !== '') {
    const gradeCode = String(hayJobGrade);
    const band = gradeMap.get(gradeCode);
    if (band) return { band };
    return {
      band: null,
      error: {
        code: 'NO_GRADE_MAP',
        message: `Grade code "${gradeCode}" not found in normalisation map`,
      },
    };
  }

  if (lastDrawnSalary != null && lastDrawnSalary > 0) {
    const match = salaryBands.find(
      (rule) =>
        lastDrawnSalary >= rule.minSalary &&
        (rule.maxSalary == null || lastDrawnSalary <= rule.maxSalary),
    );
    if (match) return { band: match.standardBand };
    return {
      band: null,
      error: {
        code: 'NO_SALARY_BAND',
        message: `Salary ${lastDrawnSalary} does not match any salary band rule`,
      },
    };
  }

  return {
    band: null,
    error: { code: 'MISSING_GRADE', message: 'No grade, salary, or band override available' },
  };
}

export function classifyEmployee(
  employeeData: Record<string, unknown>,
  gradeMap: ReadonlyMap<string, StandardBand>,
  salaryBands: ReadonlyArray<{
    minSalary: number;
    maxSalary: number | null;
    standardBand: StandardBand;
  }>,
): EmployeeClassification {
  const workPassType = employeeData['employee.work_pass_type'] as string | null | undefined;
  const employmentType = resolveEmploymentType(workPassType);

  const rawEmploymentClass = employeeData['employee.employment_type'] as string | null | undefined;
  const overrideClass = isOverrideEmploymentClass(rawEmploymentClass);

  if (overrideClass) {
    return {
      employmentType,
      isOverrideClass: true,
      employmentClass: rawEmploymentClass as OverrideClass,
      standardBand: null,
    };
  }

  const salaryBandOverride = employeeData['employee.salary_band_override'] as
    | string
    | null
    | undefined;
  const hayJobGrade = employeeData['employee.hay_job_grade'] as number | string | null | undefined;
  const lastDrawnSalary = employeeData['employee.last_drawn_salary'] as number | null | undefined;

  const { band, error } = resolveStandardBand(
    salaryBandOverride,
    hayJobGrade,
    lastDrawnSalary,
    gradeMap,
    salaryBands,
  );

  const result: EmployeeClassification = {
    employmentType,
    isOverrideClass: false,
    employmentClass: rawEmploymentClass ?? null,
    standardBand: band,
  };
  if (error) result.error = error;
  return result;
}
