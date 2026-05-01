// =============================================================
// Per-product extraction schema.
//
// Stage 2 of the map-reduce extraction. Each pass returns a single
// ExtractedProduct envelope (not an array — one product per call).
//
// We re-use packages/catalogue-schemas/extracted-product.json
// verbatim so the per-product shape stays in lock-step with the
// catalogue contract. The compiled validator is cached via the
// shared catalogue Ajv singleton so repeat extractions in the same
// process reuse the compile.
//
// Tool input schema sanitisation (strip $schema/$id) happens in the
// runner via foundry-client.stripSchemaMeta — Anthropic rejects
// schemas with $schema keys, OpenAI's strict mode rejects some
// draft-7 idioms. The compiled validator here keeps the full schema.
// =============================================================

import { type ValidateFunction, formatAjvError, safeCompile } from '@/server/catalogue/ajv';
import extractedProductSchema from '../../../../../../packages/catalogue-schemas/extracted-product.json';

export const productSchema = extractedProductSchema as Record<string, unknown>;

export function getProductValidator(): ValidateFunction {
  const result = safeCompile(productSchema, 'extraction:product-v1');
  if (!result.ok) {
    throw new Error(`Product schema failed to compile: ${result.error}`);
  }
  return result.validate;
}

export function formatProductAjvErrors(errors: ValidateFunction['errors']): string {
  if (!errors || errors.length === 0) return '(no error details)';
  return errors.slice(0, 12).map(formatAjvError).join('\n');
}

export const PRODUCT_TOOL_NAME = 'emit_product';

export const PRODUCT_TOOL_DESCRIPTION =
  'Emit a single ExtractedProduct envelope for the (productTypeCode, insurerCode) pair the ' +
  'user message specifies. Cite source cells using the A1 references in the workbook ' +
  'serialization. Always return arrays (plans, premiumRates, benefits, etc.) even when empty.';
