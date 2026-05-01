// =============================================================
// Per-product extraction schema.
//
// Stage 2 of the map-reduce extraction. Each pass returns a single
// ExtractedProduct envelope (not an array — one product per call).
//
// We re-use packages/catalogue-schemas/extracted-product.json
// verbatim so the per-product shape stays in lock-step with the
// catalogue contract. The Ajv-compiled validator is exported as a
// singleton; the runner uses it to enforce the contract on every
// model response.
//
// Tool input schema sanitisation (strip $schema/$id) happens in the
// runner — Anthropic rejects schemas with $schema keys, OpenAI's
// strict mode rejects some draft-7 idioms. The compiled validator
// here keeps the full schema (Ajv handles it fine).
// =============================================================

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import extractedProductSchema from '../../../../../../packages/catalogue-schemas/extracted-product.json';

const ajv = new Ajv({
  allErrors: true,
  removeAdditional: false,
  strict: false,
});
addFormats(ajv);

export const productSchema = extractedProductSchema as Record<string, unknown>;

let _validator: ValidateFunction | null = null;
export function getProductValidator(): ValidateFunction {
  if (!_validator) {
    _validator = ajv.compile(productSchema);
  }
  return _validator;
}

export function formatProductAjvErrors(errors: ValidateFunction['errors']): string {
  if (!errors || errors.length === 0) return '(no error details)';
  return errors
    .slice(0, 12)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
    .join('\n');
}

export const PRODUCT_TOOL_NAME = 'emit_product';

export const PRODUCT_TOOL_DESCRIPTION =
  'Emit a single ExtractedProduct envelope for the (productTypeCode, insurerCode) pair the ' +
  'user message specifies. Cite source cells using the A1 references in the workbook ' +
  'serialization. Always return arrays (plans, premiumRates, benefits, etc.) even when empty.';
