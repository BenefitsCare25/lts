// =============================================================
// Prompt builders for the AI extraction layer.
//
// Two pieces:
//   buildSystemPrompt(catalogue) — stable across calls for the same
//     tenant, marked with cache_control on the Anthropic body. Holds
//     the role, the catalogue snapshot, the envelope contract, and
//     the operating rules.
//   buildUserPrompt(workbookText, retryHint?) — per-call body, holds
//     the serialized workbook plus an optional "your previous output
//     failed validation, fix this:" framing for the one-shot retry.
//
// Why separate: prompt caching only kicks in when the system block is
// byte-stable. We deliberately keep the catalogue context in `system`
// and the per-call workbook in `user` so back-to-back imports for the
// same tenant pay 10% of the input cost on the second call onwards.
// =============================================================

import type { CatalogueContext } from './catalogue-context';

export const EXTRACTION_TOOL_NAME = 'emit_extraction';

export const EXTRACTION_TOOL_DESCRIPTION =
  'Emit the structured extraction result for the placement slip workbook.\n' +
  'Every field must be filled exactly once. Use null for any value the workbook does not provide; ' +
  'do not guess. Cite source cells using the A1 references that appear in the workbook serialization ' +
  '(e.g. "B12"). Always return arrays even when empty.';

export function buildSystemPrompt(catalogue: CatalogueContext): string {
  const lines: string[] = [];
  lines.push(
    'You are an extraction engine for an insurance brokerage SaaS. The broker has uploaded',
    'an employee-benefits placement slip (Excel workbook) and needs you to populate the',
    'wizard that creates the client, policies, products, plans, premium rates, and',
    'eligibility rules from a single document.',
    '',
    'Output a single tool call to `emit_extraction` matching the provided JSON schema.',
    'Never include conversational text — every byte of your response must be the tool input.',
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
    'UPPER_SNAKE form (e.g. "AIA_SG" for "AIA Singapore") and set the proposedInsurers entry',
    'with confidence ≤ 0.6 — the broker will register it.',
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
    '## Envelope shape',
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
    '## Section guidance',
    '',
    '`products[]` — one entry per (insurer × product type) sheet or section. STM-style',
    'workbooks where four insurers cover GHS each → four GHS entries. Aggregator workbooks',
    'where one insurer covers four product types → four entries with the same insurerCode.',
    '',
    '`proposedClient` — the policyholder. Look in any sheet header — the legal entity name,',
    'UEN/registration number, registered address, business activity description. If multiple',
    'sheets disagree, prefer the value that appears in the most sheets.',
    '',
    '`proposedPolicyEntities[]` — every legal entity covered by the master policy. Some slips',
    'split entities across separate sheets ("PolicyEntities" or "Insured Persons" tab); others',
    'list them inline in the header. Mark exactly one entity as `isMaster: true` (the entity',
    'whose policy number is the headline number on the slip cover page).',
    '',
    '`proposedBenefitYear` — `policyName` is typically a phrase like "2026 Renewal — Employee',
    'Benefits Programme" or simply the master entity name + year. `startDate`/`endDate` come',
    'from the period of insurance row that nearly every product header carries — pick the',
    'period that the most products share. `ageBasis` defaults to POLICY_START unless the slip',
    'mentions hire-date or event-based age computation explicitly.',
    '',
    '`proposedInsurers[]` — one entry per unique insurer the slip references. `productCount`',
    'is how many product entries you returned for that insurer.',
    '',
    '`proposedPool` — set when the slip mentions a captive / industry pool (e.g. "NTUC GBT",',
    '"PAP-CARE Pool"). Match against the catalogue list when possible. Null when no pool.',
    '',
    '`warnings[]` — caveats the broker should know: contradictions between sheets, ambiguous',
    'plan stacking, missing rate cells, illegible cell text, etc.',
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

export function buildUserPrompt(workbookText: string, retryHint?: string): string {
  const retryBlock = retryHint
    ? [
        '',
        '## Retry — your previous response failed schema validation',
        '',
        'Fix the following issues and re-emit the FULL extraction (not just the deltas):',
        '```',
        retryHint,
        '```',
        '',
      ]
    : [];
  return [
    'Here is the placement slip workbook, serialized as one block per sheet with A1-tagged',
    'cell values. Empty cells are omitted; cells over 800 chars are truncated with an ellipsis.',
    ...retryBlock,
    '## Workbook',
    '',
    workbookText,
    '',
    '## Now emit the extraction',
    '',
    'Call the `emit_extraction` tool exactly once with the full result.',
  ].join('\n');
}
