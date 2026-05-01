/**
 * Generate Zod schemas from the extracted-product.json JSON Schema.
 * Run: pnpm schemas:generate
 *
 * Writes apps/web/src/server/extraction/_generated-schemas.ts.
 * CI gate: pnpm schemas:generate && git diff --exit-code src/server/extraction/_generated-schemas.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { jsonSchemaToZod } from 'json-schema-to-zod';

const schemaPath = path.resolve(
  __dirname,
  '../../../packages/catalogue-schemas/extracted-product.json',
);
const outputPath = path.resolve(__dirname, '../src/server/extraction/_generated-schemas.ts');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

const zodCode = jsonSchemaToZod(schema, {
  name: 'extractedProductSchema',
  module: 'esm',
  type: true,
});

const header = `// =============================================================
// AUTO-GENERATED — do not edit by hand.
// Source: packages/catalogue-schemas/extracted-product.json
// Regenerate: pnpm schemas:generate
// =============================================================

`;

fs.writeFileSync(outputPath, header + zodCode, 'utf-8');

console.info(`Generated: ${outputPath}`);
