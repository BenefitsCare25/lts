// =============================================================
// ExtractionDraft JSONB write guard.
//
// Call checkExtractedProducts() immediately before any
//   prisma.extractionDraft.update({ data: { extractedProducts: … } })
// to validate the array against the canonical JSON Schema.
//
// Default (permissive): issues are logged + returned so the caller
// can store them in draft.validationIssues — the write still proceeds
// so a schema-violation never silently blocks the broker.
//
// Strict (EXTRACTION_VALIDATION_STRICT=true): throws instead of
// returning, making the extraction job fail rather than persist
// invalid data. Enable in integration tests and CI once the AI
// output is stable.
// =============================================================

import { formatAjvError } from '@/server/catalogue/ajv';
import { getExtractedProductValidator } from '@/server/ingestion/extracted-product-schema';

export type PersistValidationResult = { ok: true } | { ok: false; issues: string[] };

// Validate every item in an extractedProducts array against the
// extracted-product.json JSON Schema. Runs Ajv against each element
// individually so errors are namespaced to the right index.
export function validateExtractedProducts(products: unknown[]): PersistValidationResult {
  const validator = getExtractedProductValidator();
  if (!validator.ok) {
    return { ok: false, issues: [`Schema compile failed: ${validator.error}`] };
  }

  const issues: string[] = [];
  for (const [i, product] of products.entries()) {
    const valid = validator.validate(product);
    if (!valid && validator.validate.errors?.length) {
      for (const err of validator.validate.errors) {
        issues.push(`products[${i}]${formatAjvError(err)}`);
      }
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// Validate extractedProducts before a Prisma write. Returns the list
// of issues (empty = valid). In strict mode throws instead of returning.
//
// Callers should pass the issues to draft.validationIssues so the
// wizard can surface them without blocking the broker.
export function checkExtractedProducts(products: unknown, context: string): string[] {
  if (!Array.isArray(products)) {
    const issue = 'extractedProducts is not an array';
    console.warn(`[persist][${context}] ${issue}`);
    if (process.env.EXTRACTION_VALIDATION_STRICT === 'true') {
      throw new Error(`[persist] STRICT ${context}: ${issue}`);
    }
    return [issue];
  }

  if (products.length === 0) return [];

  const result = validateExtractedProducts(products);
  if (!result.ok) {
    console.warn(
      `[persist][${context}] ${result.issues.length} validation issue(s):`,
      result.issues,
    );
    if (process.env.EXTRACTION_VALIDATION_STRICT === 'true') {
      throw new Error(`[persist] STRICT ${context}: ${result.issues.join('; ')}`);
    }
    return result.issues;
  }

  return [];
}
