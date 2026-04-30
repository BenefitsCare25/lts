// =============================================================
// Shared Ajv singleton for catalogue + product / plan / employee
// JSONB validation.
//
// Compile cache. Ajv keys its internal compile cache by reference
// equality. Schemas come back from Prisma as fresh JSONB objects on
// every read, so the internal cache hit rate is effectively zero.
// We layer an explicit cache keyed on a stable identity supplied by
// the caller (e.g. `ProductType.id:version`, `EmployeeSchema.tenantId:version`)
// — versions are immutable per CLAUDE.md, so the cached compile stays
// valid until the catalogue admin bumps the version.
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

// Cache of compiled validators keyed by the caller-supplied identity.
// Each entry is the result shape of `safeCompile` so we can serve a
// previously-compiled validator OR a previously-recorded compile error
// without re-running Ajv. Bounded only by catalogue size (one entry
// per ProductType version per tenant); fine in-process.
type CompileResult = { ok: true; validate: ValidateFunction } | { ok: false; error: string };
const validatorCache = new Map<string, CompileResult>();

// Compile a schema with try/catch so a malformed catalogue entry
// surfaces as a structured error instead of a 500. Returns
// `{ error }` when compilation fails.
//
// Pass `cacheKey` for hot-path callers (review.validate over N products,
// products.updateData, employees.create/import). Omit for one-off
// compiles where caching would just consume memory.
export function safeCompile(schema: unknown, cacheKey?: string): CompileResult {
  if (cacheKey !== undefined) {
    const cached = validatorCache.get(cacheKey);
    if (cached) return cached;
  }

  let result: CompileResult;
  try {
    // biome-ignore lint/suspicious/noExplicitAny: schema comes from JSONB
    const validate = ajv.compile(schema as any);
    result = { ok: true, validate };
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : 'Schema compile failed.',
    };
  }

  if (cacheKey !== undefined) {
    validatorCache.set(cacheKey, result);
  }
  return result;
}

// Drop an entry from the cache when the underlying schema is mutated
// (e.g. catalogue admin saves a new ProductType version with the same
// id but a bumped version). The router that performs the mutation is
// the canonical place to call this.
export function invalidateCompiled(cacheKey: string): void {
  validatorCache.delete(cacheKey);
}

// For tests that want a clean slate.
export function __resetCompileCacheForTests(): void {
  validatorCache.clear();
}

export function formatAjvError(err: ErrorObject): string {
  const path = err.instancePath || '/';
  return `${path} ${err.message ?? 'is invalid'}`;
}

export type { ErrorObject, ValidateFunction };
