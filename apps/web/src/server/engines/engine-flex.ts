import type { Dependent } from '@prisma/client';
import type {
  DependentCounts,
  EmploymentType,
  FlexResolution,
  FlexTierBase,
  FlexTierKey,
} from './types';

export function countActiveDependents(
  dependents: ReadonlyArray<Pick<Dependent, 'relation' | 'data'>>,
  childMaxAge: number,
  referenceDate: Date = new Date(),
): DependentCounts {
  let activeSpouse = 0;
  let activeChildren = 0;

  for (const dep of dependents) {
    const data = dep.data as Record<string, unknown> | null;
    const dob = data?.date_of_birth;

    if (dep.relation === 'spouse') {
      activeSpouse++;
    } else if (dep.relation === 'child') {
      if (dob) {
        const birthDate = new Date(dob as string);
        const age = differenceInYears(referenceDate, birthDate);
        if (age < childMaxAge) {
          activeChildren++;
        }
      } else {
        activeChildren++;
      }
    }
  }

  return { activeSpouse, activeChildren };
}

function differenceInYears(later: Date, earlier: Date): number {
  let years = later.getFullYear() - earlier.getFullYear();
  const monthDiff = later.getMonth() - earlier.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && later.getDate() < earlier.getDate())) {
    years--;
  }
  return years;
}

export function deriveFlexTierKey(
  employmentType: EmploymentType,
  maritalStatus: string | null | undefined,
  counts: DependentCounts,
): FlexTierKey {
  const isMarried = maritalStatus?.toUpperCase() === 'MARRIED' || counts.activeSpouse > 0;
  const childBucket = Math.min(counts.activeChildren, 2);
  const isSingleParent = !isMarried && counts.activeChildren > 0;

  let base: FlexTierBase;

  if (isSingleParent) {
    base = childBucket >= 2 ? 'SINGLE_PARENT_2' : 'SINGLE_PARENT_1';
  } else if (!isMarried) {
    base = 'SINGLE';
  } else {
    if (childBucket === 0) base = 'MARRIED_0';
    else if (childBucket === 1) base = 'MARRIED_1';
    else base = 'MARRIED_2PLUS';
  }

  return `${base}_${employmentType}`;
}

export function resolveFlexWallet(
  employeeId: string,
  employmentType: EmploymentType,
  maritalStatus: string | null | undefined,
  counts: DependentCounts,
  flexRules: ReadonlyMap<string, { creditAmount: number; tierLabel: string }>,
): FlexResolution {
  const flexTierKey = deriveFlexTierKey(employmentType, maritalStatus, counts);

  const rule = flexRules.get(flexTierKey);
  if (!rule) {
    return {
      employeeId,
      flexTierKey,
      creditAmount: null,
      tierLabel: null,
      error: {
        code: 'NO_FLEX_RULE',
        message: `No flex wallet rule configured for tier "${flexTierKey}"`,
      },
    };
  }

  return {
    employeeId,
    flexTierKey,
    creditAmount: rule.creditAmount,
    tierLabel: rule.tierLabel,
  };
}
