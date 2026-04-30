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
  // "Hay Job Grade 08 to 15"
  {
    re: /Hay\s*Job\s*Grade\s*0*(\d{1,2})\s*(?:to|-|–)\s*0*(\d{1,2})/i,
    build: (m) => ({
      and: [
        { '>=': [{ var: 'employee.hay_job_grade' }, Number(m[1])] },
        { '<=': [{ var: 'employee.hay_job_grade' }, Number(m[2])] },
      ],
    }),
  },
  // "Foreign Workers" / "Work Permit or S-Pass"
  {
    re: /Foreign\s*Workers?|FW\s*(?:WP|SP)|Work\s*Permit\s*or\s*S-?\s*Pass/i,
    build: () => ({ in: [{ var: 'employee.work_pass_type' }, ['WORK_PERMIT', 'S_PASS']] }),
  },
  // "Bargainable" — maps to employment_type enum (not a stand-alone
  // boolean) per the seeded EmployeeSchema STANDARD field.
  {
    re: /\bBargainable\b/i,
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

export function inferPredicateFromText(text: string): PredicateInference {
  const matches: Record<string, unknown>[] = [];
  for (const p of PREDICATE_PATTERNS) {
    const m = text.match(p.re);
    if (m) matches.push(p.build(m));
  }
  if (matches.length === 0) return { predicate: {}, matchCount: 0 };
  const raw = matches.length === 1 ? (matches[0] ?? {}) : { and: matches };
  return {
    predicate: flattenAnd(raw) as Record<string, unknown>,
    matchCount: matches.length,
  };
}
