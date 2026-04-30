import type { PredicateRow } from '@/lib/predicate';
import type { EmployeeField, FormRow, OperatorRow } from './types';

// Cast a string input to the JS value the field type expects.
export const coerce = (raw: string, type: string): unknown => {
  if (type === 'integer') return Number.parseInt(raw, 10);
  if (type === 'number') return Number.parseFloat(raw);
  if (type === 'boolean') return raw === 'true';
  // string, enum, date — kept as string (date stays as YYYY-MM-DD ISO).
  return raw;
};

// Convert a UI form row into a typed PredicateRow ready for JSONLogic
// translation, or return an error string for inline display.
export function buildRow(
  row: FormRow,
  field: EmployeeField,
  op: OperatorRow,
): PredicateRow | string {
  if (op.arity === 'range') {
    if (!row.value || !row.valueHi) return 'Range operator needs both lower and upper values.';
    return {
      field: row.field,
      operator: row.operator,
      value: [coerce(row.value, field.type), coerce(row.valueHi, field.type)],
    };
  }
  if (op.arity === 'multi') {
    let values: unknown[];
    if (field.type === 'enum') {
      if (row.valueMulti.length === 0) return 'Pick at least one value.';
      values = row.valueMulti;
    } else {
      values = row.value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => coerce(s, field.type));
      if (values.length === 0) return 'Provide at least one value.';
    }
    return { field: row.field, operator: row.operator, value: values };
  }
  // single
  if (row.value === '') return 'Value is required.';
  return { field: row.field, operator: row.operator, value: coerce(row.value, field.type) };
}

export function uiRowToForm(row: PredicateRow): FormRow {
  // Arity is implicit in the value shape when round-tripping.
  if (Array.isArray(row.value) && row.operator === 'between' && row.value.length === 2) {
    return {
      field: row.field,
      operator: row.operator,
      value: String(row.value[0]),
      valueHi: String(row.value[1]),
      valueMulti: [],
    };
  }
  if (Array.isArray(row.value)) {
    return {
      field: row.field,
      operator: row.operator,
      value: row.value.join(', '),
      valueHi: '',
      valueMulti: row.value.map(String),
    };
  }
  return {
    field: row.field,
    operator: row.operator,
    value: row.value === null || row.value === undefined ? '' : String(row.value),
    valueHi: '',
    valueMulti: [],
  };
}
