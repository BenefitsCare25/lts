// =============================================================
// Placement-slip parser (S29 + S30 + S31 — Phase 1G).
//
// Generic, parsing-rules-driven Excel parser. Reads a workbook via
// exceljs, dispatches to the catalogue's `parsingRules` for the
// detected insurer template, and returns a structured ParseResult
// the review UI surfaces.
//
// **Story-level deferral:** the seeded TM_LIFE / GE_LIFE templates
// in S16's catalogue have placeholder cell coordinates. Full
// template fidelity (Balance/CUBER/STM produce specific numbers)
// requires the reference placement slips, which are not in the
// repo. The parser is structurally complete — when real templates
// land, only the seeded `parsingRules` need updating.
// =============================================================

import ExcelJS from 'exceljs';
import { normalizeToXlsxBuffer } from './xls-to-xlsx';

export type ParseIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  field?: string;
  resolved?: boolean;
};

export type ParsedProduct = {
  productTypeCode: string; // e.g. "GTL", "GHS"
  templateInsurerCode: string; // e.g. "TM_LIFE"
  fields: Record<string, unknown>;
  // `stacksOnLabel` carries the rider-base hint detected from text like
  // "additional above Plan B" — the applyToCatalogue step resolves it
  // to a real Plan.id at write time.
  plans: {
    code: string;
    row: Record<string, unknown>;
    stacksOnLabel?: string;
  }[];
  // Each rate row carries an optional `_blockIndex` when sourced from
  // a multi-block rates_blocks layout (Allianz-style per-entity blocks).
  // Single-block products emit rates without `_blockIndex`.
  rates: Record<string, unknown>[];
};

export type ParsedPolicyEntity = {
  policyNumber: string;
  legalName: string;
  isMaster: boolean;
};

export type ParsedBenefitGroup = {
  // The plan whose eligibility text seeded the predicate.
  sourceProductCode: string;
  sourcePlanLabel: string;
  // Suggested JSONLogic predicate for broker confirmation. Not auto-saved.
  predicate: Record<string, unknown>;
  // Confidence: how many recognised tokens contributed to the predicate.
  // 0 means "no patterns matched" — broker should write the predicate from scratch.
  confidence: number;
};

export type ParseResult = {
  status: 'PARSED' | 'FAILED' | 'NEEDS_REVIEW';
  // Comma-separated list of detected insurer codes. Multi-insurer slips
  // (STM-style) carry several; single-insurer slips carry one.
  detectedTemplate: string | null;
  products: ParsedProduct[];
  // Workbook-level metadata extracted once when any product's rules
  // declare a `policy_entities_block`. Empty when no such block exists.
  policyEntities: ParsedPolicyEntity[];
  // Heuristic predicate suggestions for review-screen display. The
  // broker confirms or edits before they become real BenefitGroup rows.
  benefitGroups: ParsedBenefitGroup[];
  issues: ParseIssue[];
  raw?: { sheets: string[] };
};

// Heuristic template detection — picks the first parsing rule whose
// product_field_map cells exist in the workbook. Returns null if no
// rule matches; caller surfaces that as a NEEDS_REVIEW issue.
export function detectTemplate(
  workbook: ExcelJS.Workbook,
  candidates: { insurerCode: string; rules: ParsingRules }[],
): { insurerCode: string; rules: ParsingRules } | null {
  for (const candidate of candidates) {
    const map = candidate.rules.product_field_map ?? {};
    let matches = 0;
    for (const ref of Object.values(map)) {
      const sheet = workbook.getWorksheet((ref as { sheet?: string }).sheet ?? '');
      if (sheet) matches += 1;
    }
    if (matches > 0) return candidate;
  }
  return null;
}

// Shape of ProductType.parsingRules per the S16 seed. Loose because
// the catalogue admin can extend it.
export type ParsingRules = {
  insurer_code?: string;
  template_version?: string;
  product_field_map?: Record<string, { sheet: string; cell?: string; range?: string }>;
  plans_block?: { sheet: string; startRow: number; endRow: number; codeColumn: string };
  // Single-block rate table — all rate rows on one sheet contiguously.
  rates_block?: { sheet: string; startRow: number; endRow: number };
  // Multi-block rate tables — one block per PolicyEntity (Allianz WICI).
  // Either rates_block or rates_blocks may be set; if both are present,
  // rates_blocks wins.
  rates_blocks?: {
    sheet: string;
    blocks: { startRow: number; endRow: number; label?: string }[];
  };
  // Workbook-level metadata: the list of PolicyEntities (legal entity
  // legal name + insurer-issued policy number, one row each). Identical
  // across every product on the workbook, so the parser dedupes.
  policy_entities_block?: {
    sheet: string;
    startRow: number;
    endRow: number;
    policyNumberColumn: string;
    legalNameColumn: string;
    masterRow?: number; // 1-indexed row that's flagged as master; defaults to startRow.
  };
  // Maps rate-block columns to PremiumRate fields. applyToCatalogue
  // walks parsed.rates per this map and emits one PremiumRate row
  // per (plan, [coverTier]) combination. Shape varies by premium
  // strategy:
  //
  //   salary_multiple / fixed_amount → set `ratePerThousand` (1 col)
  //   per_cover_tier                 → set `tiers` array (one col per tier)
  //   headcount_flat                 → set `fixedAmount` (1 col)
  //   earnings                       → set `ratePerThousand` (1 col), per-block
  //
  // `planMatch` is the column carrying the plan label/number that
  // links rate rows to the plans extracted from plans_block.
  rate_column_map?: {
    planMatch: string;
    ratePerThousand?: string;
    fixedAmount?: string;
    tiers?: { tier: 'EO' | 'ES' | 'EC' | 'EF'; rateColumn: string }[];
  };
};

// Unwraps an exceljs cell value to a primitive. exceljs returns rich
// objects for formulas (`.result`) and rich-text (`.richText`); we
// flatten them so downstream code sees plain strings/numbers.
function unwrapCellValue(v: unknown): unknown {
  if (v && typeof v === 'object' && 'result' in v) return (v as { result: unknown }).result;
  if (v && typeof v === 'object' && 'richText' in v) {
    const parts = (v as { richText: { text: string }[] }).richText;
    return parts.map((p) => p.text).join('');
  }
  return v ?? null;
}

function readCell(workbook: ExcelJS.Workbook, sheet: string, address: string): unknown {
  const ws = workbook.getWorksheet(sheet);
  if (!ws) return null;
  return unwrapCellValue(ws.getCell(address).value);
}

// Parses a single Product instance using its parsingRules.
function parseProduct(
  workbook: ExcelJS.Workbook,
  productTypeCode: string,
  insurerCode: string,
  rules: ParsingRules,
  issues: ParseIssue[],
): ParsedProduct {
  const fields: Record<string, unknown> = {};
  for (const [field, ref] of Object.entries(rules.product_field_map ?? {})) {
    if (ref.cell) {
      const v = readCell(workbook, ref.sheet, ref.cell);
      if (v === null || v === undefined) {
        issues.push({
          severity: 'warning',
          code: 'EMPTY_FIELD',
          message: `${productTypeCode}: ${field} at ${ref.sheet}!${ref.cell} is empty.`,
          field,
        });
      } else {
        fields[field] = v;
      }
    }
  }

  const plans: ParsedProduct['plans'] = [];
  if (rules.plans_block) {
    const ws = workbook.getWorksheet(rules.plans_block.sheet);
    if (ws) {
      for (let r = rules.plans_block.startRow; r <= rules.plans_block.endRow; r++) {
        const codeCell = ws.getCell(`${rules.plans_block.codeColumn}${r}`);
        const code = unwrapCellValue(codeCell.value);
        if (!code) break; // first empty row terminates the block
        const row: Record<string, unknown> = {};
        ws.getRow(r).eachCell((cell, col) => {
          row[`col${col}`] = unwrapCellValue(cell.value);
        });
        const codeStr = String(code);
        // Detect "additional above Plan X" — the rider-stack hint that
        // STM uses for GTL Plan C/D layering on top of B/A. The phrase
        // can appear in any column (STM has it in the cover-basis col,
        // not the plan-name col), so scan every cell value of the row.
        const plan: ParsedProduct['plans'][number] = { code: codeStr, row };
        const haystack = Object.values(row)
          .map((v) =>
            v && typeof v === 'object' && 'richText' in v
              ? (v as { richText: { text: string }[] }).richText.map((p) => p.text).join('')
              : String(v ?? ''),
          )
          .join(' ');
        const stacksMatch = haystack.match(/additional\s+above\s+Plan\s+([A-Z0-9]+)/i);
        if (stacksMatch?.[1]) plan.stacksOnLabel = `Plan ${stacksMatch[1]}`;
        plans.push(plan);
      }
    } else {
      issues.push({
        severity: 'warning',
        code: 'MISSING_SHEET',
        message: `${productTypeCode}: plans block sheet "${rules.plans_block.sheet}" not in workbook.`,
      });
    }
  }

  const rates: Record<string, unknown>[] = [];
  // rates_blocks (plural) wins when both shapes are present; single
  // rates_block path stays unchanged for backward compatibility.
  if (rules.rates_blocks) {
    const ws = workbook.getWorksheet(rules.rates_blocks.sheet);
    if (ws) {
      rules.rates_blocks.blocks.forEach((block, blockIndex) => {
        for (let r = block.startRow; r <= block.endRow; r++) {
          const row = ws.getRow(r);
          if (!row.hasValues) continue;
          const obj: Record<string, unknown> = { _blockIndex: blockIndex };
          if (block.label) obj._blockLabel = block.label;
          row.eachCell((cell, col) => {
            obj[`col${col}`] = unwrapCellValue(cell.value);
          });
          if (Object.keys(obj).length > 1) rates.push(obj);
        }
      });
    }
  } else if (rules.rates_block) {
    const ws = workbook.getWorksheet(rules.rates_block.sheet);
    if (ws) {
      for (let r = rules.rates_block.startRow; r <= rules.rates_block.endRow; r++) {
        const row = ws.getRow(r);
        if (!row.hasValues) continue;
        const obj: Record<string, unknown> = {};
        row.eachCell((cell, col) => {
          obj[`col${col}`] = unwrapCellValue(cell.value);
        });
        if (Object.keys(obj).length > 0) rates.push(obj);
      }
    }
  }

  return { productTypeCode, templateInsurerCode: insurerCode, fields, plans, rates };
}

// Extracts the workbook-level PolicyEntity list from the first product
// rule that declares a `policy_entities_block`. Idempotent across products
// — every product rule on a single workbook references the same metadata.
function extractPolicyEntities(
  workbook: ExcelJS.Workbook,
  candidates: { rules: ParsingRules }[],
): ParsedPolicyEntity[] {
  for (const c of candidates) {
    const block = c.rules.policy_entities_block;
    if (!block) continue;
    const ws = workbook.getWorksheet(block.sheet);
    if (!ws) continue;
    const masterRow = block.masterRow ?? block.startRow;
    const entities: ParsedPolicyEntity[] = [];
    for (let r = block.startRow; r <= block.endRow; r++) {
      const policyNumber = readCell(workbook, block.sheet, `${block.policyNumberColumn}${r}`);
      const legalName = readCell(workbook, block.sheet, `${block.legalNameColumn}${r}`);
      if (!policyNumber || !legalName) continue;
      entities.push({
        policyNumber: String(policyNumber).trim(),
        legalName: String(legalName).trim(),
        isMaster: r === masterRow,
      });
    }
    if (entities.length > 0) return entities;
  }
  return [];
}

// Heuristic predicate inference uses the shared pattern table in
// server/extraction/predicate-patterns.ts. Empty `{}` predicates
// signal "broker must replace" — JSONLogic treats `{}` as truthy
// so the eligibility engine must reject them without confirmation.
import { inferPredicateFromText } from '@/server/extraction/predicate-patterns';

function inferPredicate(text: string): { predicate: Record<string, unknown>; confidence: number } {
  const { predicate, matchCount } = inferPredicateFromText(text);
  return { predicate, confidence: matchCount };
}

function inferBenefitGroups(products: ParsedProduct[]): ParsedBenefitGroup[] {
  // De-dupe by source label across products — STM's GHS Plans 4/5/6
  // and the equivalent SP/GMM rows describe the same employee groups.
  const seen = new Map<string, ParsedBenefitGroup>();
  for (const product of products) {
    for (const plan of product.plans) {
      const label = String(plan.code).replace(/\s+/g, ' ').trim();
      if (label.length === 0 || seen.has(label)) continue;
      const { predicate, confidence } = inferPredicate(label);
      seen.set(label, {
        sourceProductCode: product.productTypeCode,
        sourcePlanLabel: label,
        predicate,
        confidence,
      });
    }
  }
  return Array.from(seen.values());
}

// Top-level entry point. Iterates ProductType.parsingRules across
// the catalogue, picks the matching insurer template, and returns
// one ParsedProduct per ProductType that classifies.
export async function parsePlacementSlip(
  fileBuffer: Buffer,
  catalogueRules: { productTypeCode: string; rules: Record<string, ParsingRules> }[],
): Promise<ParseResult> {
  const issues: ParseIssue[] = [];
  let workbook: ExcelJS.Workbook;
  try {
    // .xls inputs are converted to .xlsx in memory before exceljs
    // sees them. .xlsx inputs pass through unchanged. See
    // xls-to-xlsx.ts for the security boundary around SheetJS.
    const xlsxBuffer = normalizeToXlsxBuffer(fileBuffer);
    workbook = new ExcelJS.Workbook();
    // exceljs's `load` accepts ArrayBuffer-shaped input. Pass the
    // underlying ArrayBuffer slice so the Node `Buffer<ArrayBufferLike>`
    // → `ArrayBuffer` typing mismatch in @types/exceljs disappears.
    const arrayBuffer = xlsxBuffer.buffer.slice(
      xlsxBuffer.byteOffset,
      xlsxBuffer.byteOffset + xlsxBuffer.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
  } catch (err) {
    return {
      status: 'FAILED',
      detectedTemplate: null,
      products: [],
      policyEntities: [],
      benefitGroups: [],
      issues: [
        {
          severity: 'error',
          code: 'NOT_AN_EXCEL_FILE',
          message: err instanceof Error ? err.message : 'Could not read file as Excel workbook.',
        },
      ],
    };
  }

  const sheets = (workbook.worksheets ?? []).map((w) => w.name);
  if (sheets.length === 0) {
    return {
      status: 'FAILED',
      detectedTemplate: null,
      products: [],
      policyEntities: [],
      benefitGroups: [],
      issues: [{ severity: 'error', code: 'EMPTY_WORKBOOK', message: 'Workbook has no sheets.' }],
      raw: { sheets },
    };
  }

  // Flatten the catalogue per (productTypeCode, insurerTemplate) pair.
  const candidates: { productTypeCode: string; insurerCode: string; rules: ParsingRules }[] = [];
  for (const c of catalogueRules) {
    for (const [insurerCode, rules] of Object.entries(c.rules)) {
      candidates.push({ productTypeCode: c.productTypeCode, insurerCode, rules });
    }
  }

  // Detect templates per insurer. Real-world placement slips routinely
  // span multiple insurers in one workbook (e.g. STM has 4 GE products,
  // 1 Zurich, 1 Chubb, 1 Allianz). Dispatch every (productType × insurer)
  // candidate whose sheet exists in the workbook, not just the first.
  const groups = candidates.reduce<Record<string, typeof candidates>>((acc, c) => {
    acc[c.insurerCode] ??= [];
    acc[c.insurerCode]?.push(c);
    return acc;
  }, {});

  const detectedInsurers: string[] = [];
  for (const insurerCode of Object.keys(groups)) {
    const list = groups[insurerCode];
    if (!list || list.length === 0) continue;
    const first = list[0];
    if (!first) continue;
    const detected = detectTemplate(workbook, [
      { insurerCode: first.insurerCode, rules: first.rules },
    ]);
    if (detected) detectedInsurers.push(insurerCode);
  }

  if (detectedInsurers.length === 0) {
    return {
      status: 'NEEDS_REVIEW',
      detectedTemplate: null,
      products: [],
      policyEntities: [],
      benefitGroups: [],
      issues: [
        {
          severity: 'error',
          code: 'TEMPLATE_NOT_DETECTED',
          message:
            'Could not match this workbook to any insurer template in the catalogue. Add or update parsing rules.',
        },
      ],
      raw: { sheets },
    };
  }

  // Sheet-existence is the per-product gate. Without it, a Chubb-only
  // workbook would still try to parse GE_LIFE candidates and emit
  // false-positive MISSING_SHEET issues for every GE product type.
  const products: ParsedProduct[] = [];
  for (const insurerCode of detectedInsurers) {
    const matchingCandidates = groups[insurerCode] ?? [];
    for (const c of matchingCandidates) {
      const productSheet = c.rules.plans_block?.sheet ?? c.rules.rates_block?.sheet;
      if (productSheet && !workbook.getWorksheet(productSheet)) continue;
      products.push(parseProduct(workbook, c.productTypeCode, c.insurerCode, c.rules, issues));
    }
  }

  // Workbook-level metadata extracted once across all detected candidates.
  const allMatchingCandidates = detectedInsurers.flatMap((i) => groups[i] ?? []);
  const policyEntities = extractPolicyEntities(workbook, allMatchingCandidates);
  const benefitGroups = inferBenefitGroups(products);

  const status: ParseResult['status'] = issues.some((i) => i.severity === 'error')
    ? 'FAILED'
    : issues.length > 0
      ? 'NEEDS_REVIEW'
      : 'PARSED';

  return {
    status,
    detectedTemplate: detectedInsurers.join(','),
    products,
    policyEntities,
    benefitGroups,
    issues,
    raw: { sheets },
  };
}
