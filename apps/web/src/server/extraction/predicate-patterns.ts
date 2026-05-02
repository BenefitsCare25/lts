// Shared predicate-inference table.
//
// Both the heuristic parser (server/ingestion/parser.ts) and the
// extractor's wizard-side suggester (server/extraction/predicate-suggester.ts)
// use these patterns. Keeping them in one place prevents the kind of
// silent divergence that previously had `Bargainable` mapped to two
// different EmployeeSchema fields depending on the entry point.

export type PredicateInference = {
  predicate: Record<string, unknown>;
  matchCount: number;
};

type Pattern = {
  re: RegExp;
  build: (m: RegExpMatchArray) => Record<string, unknown>;
};

// Field paths must match keys defined in
// packages/shared-types/src/employee-schema.ts (DEFAULT_EMPLOYEE_FIELDS)
// or be acknowledged as CUSTOM additions in the wizard's Schema
// Additions section.
export const PREDICATE_PATTERNS: ReadonlyArray<Pattern> = [
  // "Hay Job Grade 18 and above"
  {
    re: /Hay\s*Job\s*Grade\s*0*(\d{1,2})\s*(?:and\s*above|\+)/i,
    build: (m) => ({ '>=': [{ var: 'employee.hay_job_grade' }, Number(m[1])] }),
  },
  // "Hay Job Grade 08 to 15" or "Grade 08 to 10 / 11 to 17" (split label — both sides same plan)
  // Capture all range numbers: first range lo/hi, then optional second range lo/hi.
  // Span the full extent: >= min(all lows) AND <= max(all highs).
  {
    re: /Hay\s*Job\s*Grade\s*0*(\d{1,2})\s*(?:to|-|–)\s*0*(\d{1,2})(?:\s*\/\s*(?:Hay\s*Job\s*Grade\s*)?0*(\d{1,2})\s*(?:to|-|–)\s*0*(\d{1,2}))?/i,
    build: (m) => {
      const lo = Math.min(Number(m[1]), m[3] ? Number(m[3]) : Number(m[1]));
      const hi = Math.max(Number(m[2]), m[4] ? Number(m[4]) : Number(m[2]));
      return {
        and: [
          { '>=': [{ var: 'employee.hay_job_grade' }, lo] },
          { '<=': [{ var: 'employee.hay_job_grade' }, hi] },
        ],
      };
    },
  },
  // "Foreign Workers" / "Work Permit or S-Pass"
  {
    re: /Foreign\s*Workers?|FW\s*(?:WP|SP)|Work\s*Permit\s*or\s*S-?\s*Pass/i,
    build: () => ({ in: [{ var: 'employee.work_pass_type' }, ['WORK_PERMIT', 'S_PASS']] }),
  },
  // "Non-bargainable" — must come before Bargainable to take precedence.
  {
    re: /\bNon[\s-]*bargainable\b/i,
    build: () => ({ '==': [{ var: 'employee.employment_type' }, 'NON_BARGAINABLE'] }),
  },
  // "Bargainable" — maps to employment_type enum (not a stand-alone
  // boolean) per the seeded EmployeeSchema STANDARD field.
  // Negative lookbehind prevents matching "Non-bargainable".
  {
    re: /(?<!non[\s-]*)\bBargainable\b/i,
    build: () => ({ '==': [{ var: 'employee.employment_type' }, 'BARGAINABLE'] }),
  },
  // "Intern" / "Contract"
  {
    re: /\bInterns?\b|\bContract\s*Employees?\b/i,
    build: () => ({ in: [{ var: 'employee.employment_type' }, ['INTERN', 'CONTRACT']] }),
  },
  // "Manual Workers"
  {
    re: /\bManual\s*Workers?\b/i,
    build: () => ({ '==': [{ var: 'employee.manual_worker' }, true] }),
  },
  // "Firefighter" / "fire-fighting team" — referenced as a CUSTOM
  // boolean field via the Schema Additions section.
  {
    re: /firefighter|fire[\s-]*fighter|firefight|emergency\s*respond/i,
    build: () => ({ '==': [{ var: 'employee.firefighter' }, true] }),
  },
];

// Flatten nested `{ and: [...] }` so { and: [{ and: [a, b] }, c] }
// collapses to { and: [a, b, c] }. JSONLogic evaluates both shapes
// the same; the flat form is what a human would write and what the
// review UI expects.
export function flattenAnd(node: unknown): unknown {
  if (!node || typeof node !== 'object' || !('and' in (node as Record<string, unknown>))) {
    return node;
  }
  const arr = (node as { and: unknown[] }).and;
  const out: unknown[] = [];
  for (const child of arr) {
    const flat = flattenAnd(child);
    if (flat && typeof flat === 'object' && 'and' in (flat as Record<string, unknown>)) {
      out.push(...(flat as { and: unknown[] }).and);
    } else {
      out.push(flat);
    }
  }
  return { and: out };
}

// Returns true if pred constrains employee.employment_type (== or in).
function isEmploymentTypePredicate(pred: Record<string, unknown>): boolean {
  const eqArr = pred['=='] as unknown[] | undefined;
  if (Array.isArray(eqArr) && eqArr.length === 2) {
    const v = eqArr[0] as Record<string, unknown> | undefined;
    if (v?.var === 'employee.employment_type') return true;
  }
  const inArr = pred.in as unknown[] | undefined;
  if (Array.isArray(inArr) && inArr.length === 2) {
    const v = inArr[0] as Record<string, unknown> | undefined;
    if (v?.var === 'employee.employment_type') return true;
  }
  return false;
}

// Returns true if pred constrains hay_job_grade.
function isGradePredicate(pred: Record<string, unknown>): boolean {
  return JSON.stringify(pred).includes('hay_job_grade');
}

export function inferPredicateFromText(text: string): PredicateInference {
  const matches: Record<string, unknown>[] = [];
  for (const p of PREDICATE_PATTERNS) {
    const m = text.match(p.re);
    if (m) matches.push(p.build(m));
  }
  if (matches.length === 0) return { predicate: {}, matchCount: 0 };
  if (matches.length === 1)
    return {
      predicate: flattenAnd(matches[0] ?? {}) as Record<string, unknown>,
      matchCount: 1,
    };

  const empTypePreds = matches.filter(isEmploymentTypePredicate);
  const otherPreds = matches.filter((m) => !isEmploymentTypePredicate(m));

  let combined: unknown;

  if (empTypePreds.length >= 2) {
    // Multiple employment types (e.g. Bargainable + Intern/Contract) → OR them.
    // An employee can only have one employment_type at a time.
    const empOr: Record<string, unknown> = { or: empTypePreds };
    combined = otherPreds.length === 0 ? empOr : { and: [empOr, ...otherPreds] };
  } else if (
    empTypePreds.length === 1 &&
    otherPreds.some(isGradePredicate) &&
    !/\bwho\s+are\b|\bthat\s+are\b/i.test(text)
  ) {
    // Grade range + employment type joined as additive populations
    // (e.g. "Grade 08-15 and Bargainable Staff") → OR, not AND.
    // "Who are" / "that are" signals a subset refinement → falls through to AND.
    const gradePreds = otherPreds.filter(isGradePredicate);
    const nonGrade = otherPreds.filter((p) => !isGradePredicate(p));
    const gradeClause = gradePreds.length === 1 ? (gradePreds[0] ?? {}) : { and: gradePreds };
    const orClause: Record<string, unknown> = { or: [gradeClause, empTypePreds[0] ?? {}] };
    combined = nonGrade.length === 0 ? orClause : { and: [orClause, ...nonGrade] };
  } else {
    combined = { and: matches };
  }

  return {
    predicate: flattenAnd(combined) as Record<string, unknown>,
    matchCount: matches.length,
  };
}
