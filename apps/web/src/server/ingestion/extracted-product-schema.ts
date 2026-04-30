// =============================================================
// ExtractedProduct schema accessor.
//
// Loads packages/catalogue-schemas/extracted-product.json once and
// compiles it via the shared Ajv singleton. Used by:
//   - extractors (sanity-check their own output before persisting)
//   - extraction-drafts router (validate update mutations)
//   - applyToCatalogue adapter (defensive read on apply)
// =============================================================

import { safeCompile, type ValidateFunction } from '@/server/catalogue/ajv';
// JSON imports are first-class in TS 5+ with resolveJsonModule.
import schema from '@insurance-saas/catalogue-schemas/extracted-product.json';

let _validate: ValidateFunction | null = null;
let _compileError: string | null = null;

export function getExtractedProductValidator():
  | { ok: true; validate: ValidateFunction }
  | { ok: false; error: string } {
  if (_validate) return { ok: true, validate: _validate };
  if (_compileError) return { ok: false, error: _compileError };
  const result = safeCompile(schema);
  if (!result.ok) {
    _compileError = result.error;
    return result;
  }
  _validate = result.validate;
  return { ok: true, validate: _validate };
}

export const extractedProductSchema = schema;
