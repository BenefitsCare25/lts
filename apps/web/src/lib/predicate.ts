// =============================================================
// Predicate helpers — single-direction conversion between the UI's
// row-based shape and JSONLogic for storage.
//
// The UI builds:
//   {
//     connector: "and" | "or",
//     rows: [{ field, operator, value, valueExtra? }, ...]
//   }
//
// We persist as JSONLogic so json-logic-js can evaluate it
// against an Employee.data record at runtime.
//
// Operator → JSONLogic mapping (from the OperatorLibrary seed):
//   eq          → { "==": [{ "var": F }, V] }
//   neq         → { "!=": [{ "var": F }, V] }
//   lt/lte/gt/gte → matching JSONLogic operators
//   between     → { "and": [{ ">=": [...] }, { "<=": [...] }] }   (V = [lo, hi])
//   in          → { "in": [{ "var": F }, [v1, v2, ...]] }
//   notIn       → { "!": { "in": [...] } }
//   contains    → { "in": [V, { "var": F }] }                     (substring)
//   startsWith  → custom: { "==": [{"substr": [{"var":F}, 0, length]}, V] }
//   endsWith    → custom: same with negative offset
//   before      → { "<": [{ "var": F }, V] }      (date as ISO string)
//   after       → { ">": [{ "var": F }, V] }
//   withinDays  → { "and": [{ ">=": [{"var":F}, today-N]}, ...] }  (deferred)
// =============================================================

export type PredicateConnector = 'and' | 'or';

export type PredicateRow = {
  field: string;
  operator: string;
  // String for single-value ops; tuple [lo, hi] for between; array for in/notIn.
  value: unknown;
};

export type UiPredicate = {
  connector: PredicateConnector;
  rows: PredicateRow[];
};

// biome-ignore lint/suspicious/noExplicitAny: JSONLogic's recursive type
export type JsonLogic = any;

const VAR = (field: string): JsonLogic => ({ var: field });

// Build the JSONLogic for a single (field, operator, value) row.
// Throws on unknown operator codes — keeps the UI honest.
export function rowToJsonLogic(row: PredicateRow): JsonLogic {
  const { field, operator, value } = row;
  const v = VAR(field);
  switch (operator) {
    case 'eq':
      return { '==': [v, value] };
    case 'neq':
      return { '!=': [v, value] };
    case 'lt':
      return { '<': [v, value] };
    case 'lte':
      return { '<=': [v, value] };
    case 'gt':
      return { '>': [v, value] };
    case 'gte':
      return { '>=': [v, value] };
    case 'between': {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error('"between" expects a [lo, hi] tuple.');
      }
      return { and: [{ '>=': [v, value[0]] }, { '<=': [v, value[1]] }] };
    }
    case 'in':
      return { in: [v, value] };
    case 'notIn':
      return { '!': { in: [v, value] } };
    case 'contains':
      return { in: [value, v] };
    case 'startsWith': {
      if (typeof value !== 'string') throw new Error('"startsWith" expects a string value.');
      return { '==': [{ substr: [v, 0, value.length] }, value] };
    }
    case 'endsWith': {
      if (typeof value !== 'string') throw new Error('"endsWith" expects a string value.');
      return { '==': [{ substr: [v, -value.length] }, value] };
    }
    case 'before':
      return { '<': [v, value] };
    case 'after':
      return { '>': [v, value] };
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

// Build the full JSONLogic expression for a UI predicate.
// Single row → just that condition; multiple rows → wrapped in and/or.
export function uiPredicateToJsonLogic(p: UiPredicate): JsonLogic {
  if (p.rows.length === 0) {
    throw new Error('Predicate must have at least one row.');
  }
  if (p.rows.length === 1) {
    const only = p.rows[0];
    if (!only) throw new Error('Predicate row missing.');
    return rowToJsonLogic(only);
  }
  return { [p.connector]: p.rows.map(rowToJsonLogic) };
}

// Best-effort reverse: JSONLogic → UI shape. Returns null if the
// stored predicate isn't a shape we can round-trip (e.g. hand-edited
// JSONLogic with deeper nesting). Caller should fall back to raw JSON
// editing when this returns null.
//
// Recognises only flat (single condition) or one-level and/or with
// flat conditions inside — covers everything S18 produces. Phase 1D's
// later stories or the Excel parser may produce deeper trees; those
// land in the raw editor.
export function jsonLogicToUiPredicate(logic: JsonLogic): UiPredicate | null {
  if (!logic || typeof logic !== 'object' || Array.isArray(logic)) return null;
  const keys = Object.keys(logic);
  if (keys.length !== 1) return null;
  const op = keys[0] ?? '';

  // Flat connector
  if (op === 'and' || op === 'or') {
    const operands = logic[op];
    if (!Array.isArray(operands)) return null;
    const rows: PredicateRow[] = [];
    for (const operand of operands) {
      const row = singleConditionToRow(operand);
      if (!row) return null;
      rows.push(row);
    }
    return { connector: op, rows };
  }

  // Single condition wrapped in implicit AND
  const row = singleConditionToRow(logic);
  if (row) return { connector: 'and', rows: [row] };
  return null;
}

function singleConditionToRow(logic: JsonLogic): PredicateRow | null {
  if (!logic || typeof logic !== 'object' || Array.isArray(logic)) return null;
  const keys = Object.keys(logic);
  if (keys.length !== 1) return null;
  const op = keys[0] ?? '';
  const args = logic[op];
  if (!Array.isArray(args) || args.length < 1) return null;
  const lhs = args[0];

  // {"!": { "in": [...] }} → notIn
  if (op === '!' && lhs && typeof lhs === 'object' && 'in' in lhs) {
    const inner = (lhs as { in: unknown[] }).in;
    if (Array.isArray(inner) && inner.length === 2 && isVar(inner[0])) {
      return { field: getVar(inner[0]), operator: 'notIn', value: inner[1] };
    }
  }

  // {"and": [{">=": [...]}, {"<=": [...]}]} → between
  if (op === 'and' && Array.isArray(args) && args.length === 2) {
    const a = args[0];
    const b = args[1];
    if (a && typeof a === 'object' && '>=' in a && b && typeof b === 'object' && '<=' in b) {
      const lo = (a as { '>=': unknown[] })['>='];
      const hi = (b as { '<=': unknown[] })['<='];
      if (
        Array.isArray(lo) &&
        Array.isArray(hi) &&
        isVar(lo[0]) &&
        isVar(hi[0]) &&
        getVar(lo[0]) === getVar(hi[0])
      ) {
        return { field: getVar(lo[0]), operator: 'between', value: [lo[1], hi[1]] };
      }
    }
  }

  // Standard binary ops: { OP: [{"var": F}, value] }
  const directMap: Record<string, string> = {
    '==': 'eq',
    '!=': 'neq',
    '<': 'lt',
    '<=': 'lte',
    '>': 'gt',
    '>=': 'gte',
  };
  if (op in directMap && args.length === 2 && isVar(lhs)) {
    return { field: getVar(lhs), operator: directMap[op] ?? 'eq', value: args[1] };
  }

  // {"in": [{"var": F}, [...]]} → in
  if (op === 'in' && args.length === 2 && isVar(lhs)) {
    return { field: getVar(lhs), operator: 'in', value: args[1] };
  }
  // {"in": [value, {"var": F}]} → contains
  if (op === 'in' && args.length === 2 && isVar(args[1])) {
    return { field: getVar(args[1]), operator: 'contains', value: lhs };
  }

  return null;
}

function isVar(v: unknown): v is { var: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'var' in (v as object);
}

function getVar(v: unknown): string {
  return (v as { var: string }).var;
}
