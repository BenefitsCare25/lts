import { describe, expect, it } from 'vitest';
import { flattenAnd, inferPredicateFromText } from './predicate-patterns';

describe('inferPredicateFromText', () => {
  describe('grade range patterns', () => {
    it('matches "Grade 08-15" as a hay_job_grade range', () => {
      const result = inferPredicateFromText('Hay Job Grade 08-15');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        and: [
          { '>=': [{ var: 'employee.hay_job_grade' }, 8] },
          { '<=': [{ var: 'employee.hay_job_grade' }, 15] },
        ],
      });
    });

    it('matches "Grade 16 and above" as >= predicate', () => {
      const result = inferPredicateFromText('Hay Job Grade 16 and above');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        '>=': [{ var: 'employee.hay_job_grade' }, 16],
      });
    });

    it('matches "Grade 18+" as >= predicate', () => {
      const result = inferPredicateFromText('Hay Job Grade 18+');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        '>=': [{ var: 'employee.hay_job_grade' }, 18],
      });
    });

    it('matches "Grade 01 and above" stripping leading zero', () => {
      const result = inferPredicateFromText('Hay Job Grade 01 and above');
      expect(result.predicate).toEqual({
        '>=': [{ var: 'employee.hay_job_grade' }, 1],
      });
    });

    it('matches grade range with dash separator', () => {
      const result = inferPredicateFromText('Hay Job Grade 08 to 15');
      expect(result.predicate).toEqual({
        and: [
          { '>=': [{ var: 'employee.hay_job_grade' }, 8] },
          { '<=': [{ var: 'employee.hay_job_grade' }, 15] },
        ],
      });
    });
  });

  describe('split-range grade labels', () => {
    it('spans full extent for "Grade 08 to 10 / 11 to 17"', () => {
      const result = inferPredicateFromText('Hay Job Grade 08 to 10 / 11 to 17');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        and: [
          { '>=': [{ var: 'employee.hay_job_grade' }, 8] },
          { '<=': [{ var: 'employee.hay_job_grade' }, 17] },
        ],
      });
    });

    it('takes the minimum lower bound when first range starts higher', () => {
      const result = inferPredicateFromText('Hay Job Grade 05 to 07 / 10 to 15');
      expect(result.predicate).toEqual({
        and: [
          { '>=': [{ var: 'employee.hay_job_grade' }, 5] },
          { '<=': [{ var: 'employee.hay_job_grade' }, 15] },
        ],
      });
    });
  });

  describe('employment type patterns', () => {
    it('matches "Bargainable Employees" → BARGAINABLE', () => {
      const result = inferPredicateFromText('Bargainable Employees');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        '==': [{ var: 'employee.employment_type' }, 'BARGAINABLE'],
      });
    });

    it('matches "Non-Bargainable" → NON_BARGAINABLE', () => {
      const result = inferPredicateFromText('Non-Bargainable Employees');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        '==': [{ var: 'employee.employment_type' }, 'NON_BARGAINABLE'],
      });
    });

    it('does not match NON_BARGAINABLE as BARGAINABLE', () => {
      const result = inferPredicateFromText('Non-Bargainable Employees');
      expect(JSON.stringify(result.predicate)).not.toContain('"BARGAINABLE"');
      expect(JSON.stringify(result.predicate)).toContain('NON_BARGAINABLE');
    });

    it('matches "Non Bargainable" (space variant) → NON_BARGAINABLE', () => {
      const result = inferPredicateFromText('Non Bargainable Staff');
      expect(result.predicate).toEqual({
        '==': [{ var: 'employee.employment_type' }, 'NON_BARGAINABLE'],
      });
    });

    it('matches "Interns" → INTERN/CONTRACT', () => {
      const result = inferPredicateFromText('All Interns');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        in: [{ var: 'employee.employment_type' }, ['INTERN', 'CONTRACT']],
      });
    });

    it('matches "Contract Employees" → INTERN/CONTRACT', () => {
      const result = inferPredicateFromText('Contract Employees');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        in: [{ var: 'employee.employment_type' }, ['INTERN', 'CONTRACT']],
      });
    });
  });

  describe('foreign-worker patterns', () => {
    it('matches "Work Permit or S-Pass"', () => {
      const result = inferPredicateFromText('Work Permit or S-Pass Employees');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        in: [{ var: 'employee.work_pass_type' }, ['WORK_PERMIT', 'S_PASS']],
      });
    });

    it('matches "Foreign Workers"', () => {
      const result = inferPredicateFromText('Foreign Workers');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        in: [{ var: 'employee.work_pass_type' }, ['WORK_PERMIT', 'S_PASS']],
      });
    });

    it('matches "FW WP" short form', () => {
      const result = inferPredicateFromText('FW WP employees');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        in: [{ var: 'employee.work_pass_type' }, ['WORK_PERMIT', 'S_PASS']],
      });
    });
  });

  describe('manual worker and firefighter patterns', () => {
    it('matches "Manual Workers"', () => {
      const result = inferPredicateFromText('Manual Workers');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        '==': [{ var: 'employee.manual_worker' }, true],
      });
    });

    it('matches "firefighter"', () => {
      const result = inferPredicateFromText('firefighter team');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        '==': [{ var: 'employee.firefighter' }, true],
      });
    });

    it('matches "fire-fighting team"', () => {
      const result = inferPredicateFromText('fire-fighting team members');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        '==': [{ var: 'employee.firefighter' }, true],
      });
    });
  });

  describe('combining logic', () => {
    it('ORs two employment-type patterns (Bargainable + Interns/Contract)', () => {
      const result = inferPredicateFromText('Bargainable Employees, Interns & Contract Employees');
      expect(result.matchCount).toBe(2);
      const pred = result.predicate;
      expect(pred).toHaveProperty('or');
      const orClause = (pred as { or: unknown[] }).or;
      expect(orClause).toHaveLength(2);
      expect(JSON.stringify(orClause)).toContain('BARGAINABLE');
      expect(JSON.stringify(orClause)).toContain('INTERN');
    });

    it('ORs grade range + employment type when label has no "who are"', () => {
      const result = inferPredicateFromText('Hay Job Grade 08-15 and Bargainable Staff');
      expect(result.matchCount).toBe(2);
      const pred = result.predicate;
      expect(pred).toHaveProperty('or');
      const orClause = (pred as { or: unknown[] }).or;
      expect(orClause).toHaveLength(2);
      expect(JSON.stringify(orClause)).toContain('hay_job_grade');
      expect(JSON.stringify(orClause)).toContain('BARGAINABLE');
    });

    it('ANDs grade + employment type when label contains "who are"', () => {
      const result = inferPredicateFromText('Hay Job Grade 08-15 employees who are Bargainable');
      expect(result.matchCount).toBe(2);
      const pred = result.predicate;
      expect(pred).toHaveProperty('and');
      const andClause = (pred as { and: unknown[] }).and;
      expect(JSON.stringify(andClause)).toContain('hay_job_grade');
      expect(JSON.stringify(andClause)).toContain('BARGAINABLE');
    });

    it('ANDs grade + employment type when label contains "that are"', () => {
      const result = inferPredicateFromText('Hay Job Grade 16+ employees that are Non-Bargainable');
      expect(result.matchCount).toBe(2);
      expect(result.predicate).toHaveProperty('and');
    });

    it('ANDs unrelated patterns (grade + firefighter)', () => {
      const result = inferPredicateFromText('Hay Job Grade 10-15 firefighters');
      expect(result.matchCount).toBe(2);
      expect(result.predicate).toHaveProperty('and');
    });
  });

  describe('edge cases', () => {
    it('returns empty predicate for empty string', () => {
      const result = inferPredicateFromText('');
      expect(result.matchCount).toBe(0);
      expect(result.predicate).toEqual({});
    });

    it('returns empty predicate for unknown label', () => {
      const result = inferPredicateFromText('Board of Directors');
      expect(result.matchCount).toBe(0);
      expect(result.predicate).toEqual({});
    });

    it('returns empty predicate for whitespace-only string', () => {
      const result = inferPredicateFromText('   ');
      expect(result.matchCount).toBe(0);
      expect(result.predicate).toEqual({});
    });

    it('is case-insensitive for grade match', () => {
      const result = inferPredicateFromText('hay job grade 12 and above');
      expect(result.matchCount).toBe(1);
      expect(result.predicate).toEqual({
        '>=': [{ var: 'employee.hay_job_grade' }, 12],
      });
    });
  });
});

describe('flattenAnd', () => {
  it('passes through non-and nodes unchanged', () => {
    const node = { '>=': [{ var: 'x' }, 5] };
    expect(flattenAnd(node)).toEqual(node);
  });

  it('flattens nested and nodes', () => {
    const nested = {
      and: [{ and: [{ a: 1 }, { b: 2 }] }, { c: 3 }],
    };
    expect(flattenAnd(nested)).toEqual({
      and: [{ a: 1 }, { b: 2 }, { c: 3 }],
    });
  });

  it('leaves flat and nodes unchanged', () => {
    const flat = { and: [{ a: 1 }, { b: 2 }] };
    expect(flattenAnd(flat)).toEqual(flat);
  });

  it('handles null input', () => {
    expect(flattenAnd(null)).toBeNull();
  });
});
