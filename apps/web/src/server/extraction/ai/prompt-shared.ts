// =============================================================
// Shared system prompt for the AI extraction layer.
//
// Both passes (discovery + per-product) share the same system block:
//   - Role and operating rules
//   - Catalogue snapshot (codes the model MUST use verbatim)
//   - Envelope shape contract (value/raw/confidence/sourceRef)
//   - Hard rules (no fabrication, ISO dates, etc.)
//
// Why one shared system prompt: Anthropic prompt caching keys off the
// system block bytes. By keeping a single stable preamble across every
// call in an extraction run (1 discovery + N per-product), the cache
// hit rate on calls 2..N+1 is ~90%, which is where the cost savings
// come from in the map-reduce design.
//
// Per-pass framing lives in the user prompt builders
// (prompt-discovery.ts, prompt-product.ts). Those embed the workbook
// text + pass-specific instructions.
// =============================================================

import type { CatalogueContext } from './catalogue-context';

export function buildSharedSystemPrompt(catalogue: CatalogueContext): string {
  const lines: string[] = [];
  lines.push(
    'You are an extraction engine for an insurance brokerage SaaS. The broker has uploaded',
    'an employee-benefits placement slip (Excel workbook) and needs you to populate the',
    'wizard that creates the client, policies, products, plans, premium rates, and',
    'eligibility rules from a single document.',
    '',
    'You will be called multiple times against the same workbook:',
    '- One DISCOVERY pass to identify which products are present and the cross-cutting',
    '  metadata (client, entities, benefit year, insurers, pool).',
    '- One PER-PRODUCT pass for each product the discovery identified, returning a',
    '  full ExtractedProduct envelope.',
    '',
    'Each call provides specific instructions in the user message. Always respond by',
    'calling the tool the user message names — never with conversational text.',
    '',
    '## Catalogue snapshot (use these codes verbatim)',
    '',
    'Product types — `productTypeCode` MUST match one of these:',
  );
  for (const p of catalogue.productTypes) {
    lines.push(`- ${p.code} (${p.name}, premium strategy: ${p.premiumStrategy})`);
  }
  lines.push('');
  lines.push('Insurer codes — pick the closest match by name. Slip labels often differ:');
  for (const i of catalogue.insurers) {
    lines.push(`- ${i.code}: ${i.name} (supports: ${i.productsSupported.join(', ') || '—'})`);
  }
  lines.push(
    '',
    'If the slip clearly names an insurer that is NOT in the list above, propose a new code in',
    'UPPER_SNAKE form (e.g. "AIA_SG" for "AIA Singapore") — the broker will register it.',
    '',
  );
  if (catalogue.pools.length > 0) {
    lines.push(
      'Pools (industry / captive arrangements) — `poolId` MUST match one of these or be null:',
    );
    for (const p of catalogue.pools) lines.push(`- ${p.id}: ${p.name}`);
    lines.push('');
  }
  if (catalogue.tpas.length > 0) {
    lines.push('TPAs (third-party administrators):');
    for (const t of catalogue.tpas) lines.push(`- ${t.code}: ${t.name}`);
    lines.push('');
  }
  lines.push(
    'Employee schema — only these field paths are valid for eligibility predicates.',
    'When the slip references an attribute not in this list (e.g. "Hay Job Grade"), still extract',
    "the eligibility free-text — the wizard's Schema Additions step will let the broker add the",
    'missing field. Do NOT invent new field paths in extracted predicates:',
  );
  for (const f of catalogue.employeeSchema) {
    const enums = f.enumValues && f.enumValues.length > 0 ? ` [${f.enumValues.join('|')}]` : '';
    lines.push(`- employee.${f.name} (${f.type}${enums}) — ${f.label}`);
  }
  lines.push('');
  lines.push(
    'Country codes — `countryOfIncorporation` MUST be one of (ISO-3166 alpha-2):',
    catalogue.countries.map((c) => c.code).join(', '),
    '',
    'Industry codes (SSIC). Set proposedClient.industry to one of these or null:',
  );
  for (const i of catalogue.industries.slice(0, 60)) lines.push(`- ${i.code}: ${i.name}`);
  if (catalogue.industries.length > 60) {
    lines.push(`(${catalogue.industries.length - 60} more industries available — match by name)`);
  }

  lines.push(
    '',
    '## Envelope shape (per-product passes)',
    '',
    'Most fields use a `{ value, raw, confidence, sourceRef }` envelope so the wizard can show',
    'evidence on hover. Confidence rubric:',
    '- 1.0  — verbatim from a single, unambiguous cell',
    '- 0.85 — derived from a recognised pattern in a single cell (e.g. parsed period range)',
    '- 0.6  — synthesised from multiple cells / inferred from context',
    '- 0.3  — best-guess fallback',
    '- null value with confidence 0 — the workbook does not contain the data',
    '',
    'The `sourceRef.cell` should be the A1 reference exactly as it appears in the workbook',
    'serialization (e.g. "B12"). `sourceRef.sheet` is the sheet name. Use `range` only for',
    'multi-cell evidence (e.g. a 5-row premium-rates block).',
    '',
    '## Hard rules',
    '',
    '1. Never fabricate a value that is not in the workbook. Use null + confidence 0 instead.',
    '2. Always emit every required key in the schema — empty arrays for products with no rates,',
    '   null for missing string fields, etc.',
    '3. Use only product type codes, insurer codes, country codes, industry codes, and employee',
    '   schema field paths from the catalogue snapshot above. Propose a NEW insurer code only',
    '   when none of the existing ones plausibly match.',
    '4. Dates must be ISO `yyyy-mm-dd`. Currency codes must be ISO 4217 (SGD, USD, EUR, …).',
    '5. The model is operating on Singapore placement slips by default. Treat ambiguous dates',
    '   as DD/MM/YYYY. UEN format is typically 9 chars (8 digits + letter, or 4 digits + 4',
    '   chars + letter); when in doubt set confidence 0.6 and let the broker correct.',
    `6. Tenant: ${catalogue.meta.tenantSlug}. Today's date: ${new Date().toISOString().slice(0, 10)}.`,
  );
  return lines.join('\n');
}
