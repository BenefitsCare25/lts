// =============================================================
// Shared Ajv singleton for catalogue + product / plan / employee
// JSONB validation.
//
// One instance per process. Ajv caches compiled schemas internally
// keyed by reference equality, so a singleton lets unchanged
// catalogue schemas hit the compile cache across requests.
//
// `strict: false` keeps tolerances loose for non-standard keywords
// the catalogue admin may add (descriptions, format aliases). The
// trade-off is that a pathological schema (deeply recursive $refs,
// huge enum arrays) could blow compile/runtime; callers must wrap
// `compile()` in a try/catch and surface the failure as an issue
// rather than crashing the request.
// =============================================================

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Compile a schema with try/catch so a malformed catalogue entry
// surfaces as a structured error instead of a 500. Returns
// `{ error }` when compilation fails.
export function safeCompile(
  schema: unknown,
): { ok: true; validate: ValidateFunction } | { ok: false; error: string } {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: schema comes from JSONB
    const validate = ajv.compile(schema as any);
    return { ok: true, validate };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Schema compile failed.',
    };
  }
}

export function formatAjvError(err: ErrorObject): string {
  const path = err.instancePath || '/';
  return `${path} ${err.message ?? 'is invalid'}`;
}

export type { ErrorObject, ValidateFunction };
