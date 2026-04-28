// =============================================================
// JSONLogic adapter + predicate translation tests.
// Pairs with the size/depth/node caps enforced server-side in
// benefit-groups.ts (those caps are tested via the live tRPC
// validator wherever Vitest can reach Zod's superRefine).
// =============================================================

import {
  jsonLogicToUiPredicate,
  rowToJsonLogic,
  uiPredicateToJsonLogic,
} from '@/lib/predicate';
import { describe, expect, it } from 'vitest';

describe('rowToJsonLogic', () => {
  it('emits ==/!= for eq/neq', () => {
    expect(rowToJsonLogic({ field: 'employee.f', operator: 'eq', value: 'X' })).toEqual({
      '==': [{ var: 'employee.f' }, 'X'],
    });
    expect(rowToJsonLogic({ field: 'employee.f', operator: 'neq', value: 1 })).toEqual({
      '!=': [{ var: 'employee.f' }, 1],
    });
  });

  it('emits and(>=, <=) for between', () => {
    expect(
      rowToJsonLogic({ field: 'employee.hjg', operator: 'between', value: [8, 10] }),
    ).toEqual({
      and: [
        { '>=': [{ var: 'employee.hjg' }, 8] },
        { '<=': [{ var: 'employee.hjg' }, 10] },
      ],
    });
  });

  it('emits ! wrapping in for notIn', () => {
    const out = rowToJsonLogic({
      field: 'employee.role',
      operator: 'notIn',
      value: ['JUNIOR'],
    });
    expect(out).toEqual({ '!': { in: [{ var: 'employee.role' }, ['JUNIOR']] } });
  });

  it('throws on unknown operator', () => {
    expect(() =>
      rowToJsonLogic({ field: 'f', operator: 'unknown_op', value: 1 }),
    ).toThrow(/Unsupported operator/);
  });
});

describe('uiPredicateToJsonLogic / jsonLogicToUiPredicate round-trip', () => {
  it('round-trips a single AND row', () => {
    const ui = {
      connector: 'and' as const,
      rows: [{ field: 'employee.work_pass_type', operator: 'eq', value: 'WORK_PERMIT' }],
    };
    const logic = uiPredicateToJsonLogic(ui);
    const back = jsonLogicToUiPredicate(logic);
    expect(back).toEqual(ui);
  });

  it('round-trips a compound AND/OR group', () => {
    const ui = {
      connector: 'or' as const,
      rows: [
        { field: 'employee.role', operator: 'eq', value: 'SENIOR_MGMT' },
        { field: 'employee.last_drawn_salary', operator: 'gt', value: 10_000 },
      ],
    };
    const logic = uiPredicateToJsonLogic(ui);
    expect(jsonLogicToUiPredicate(logic)).toEqual(ui);
  });

  it('returns null for a shape the builder cannot represent', () => {
    const deep = { and: [{ and: [{ '==': [{ var: 'a' }, 1] }] }] };
    expect(jsonLogicToUiPredicate(deep)).toBeNull();
  });
});
