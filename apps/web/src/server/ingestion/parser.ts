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
  plans: { code: string; row: Record<string, unknown> }[];
  rates: Record<string, unknown>[];
};

export type ParseResult = {
  status: 'PARSED' | 'FAILED' | 'NEEDS_REVIEW';
  detectedTemplate: string | null;
  products: ParsedProduct[];
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
  rates_block?: { sheet: string; startRow: number; endRow: number };
};

// Reads a cell value as a primitive. exceljs returns rich objects
// for formulas; we unwrap to .result when present.
function readCell(workbook: ExcelJS.Workbook, sheet: string, address: string): unknown {
  const ws = workbook.getWorksheet(sheet);
  if (!ws) return null;
  const cell = ws.getCell(address);
  const v = cell.value;
  if (v && typeof v === 'object' && 'result' in v) return v.result;
  if (v && typeof v === 'object' && 'richText' in v) {
    const parts = (v as { richText: { text: string }[] }).richText;
    return parts.map((p) => p.text).join('');
  }
  return v ?? null;
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
        const code = codeCell.value;
        if (!code) break; // first empty row terminates the block
        const row: Record<string, unknown> = {};
        ws.getRow(r).eachCell((cell, col) => {
          row[`col${col}`] = cell.value;
        });
        plans.push({ code: String(code), row });
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
  if (rules.rates_block) {
    const ws = workbook.getWorksheet(rules.rates_block.sheet);
    if (ws) {
      for (let r = rules.rates_block.startRow; r <= rules.rates_block.endRow; r++) {
        const row = ws.getRow(r);
        if (!row.hasValues) continue;
        const obj: Record<string, unknown> = {};
        row.eachCell((cell, col) => {
          obj[`col${col}`] = cell.value;
        });
        if (Object.keys(obj).length > 0) rates.push(obj);
      }
    }
  }

  return { productTypeCode, templateInsurerCode: insurerCode, fields, plans, rates };
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
    workbook = new ExcelJS.Workbook();
    // exceljs's `load` accepts ArrayBuffer-shaped input. Pass the
    // underlying ArrayBuffer slice so the Node `Buffer<ArrayBufferLike>`
    // → `ArrayBuffer` typing mismatch in @types/exceljs disappears.
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
  } catch (err) {
    return {
      status: 'FAILED',
      detectedTemplate: null,
      products: [],
      issues: [
        {
          severity: 'error',
          code: 'NOT_AN_EXCEL_FILE',
          message: err instanceof Error ? err.message : 'Could not read file as XLSX.',
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

  // Detect template from the first matching insurer with a sheet hit.
  const groups = candidates.reduce<Record<string, typeof candidates>>((acc, c) => {
    acc[c.insurerCode] ??= [];
    acc[c.insurerCode]?.push(c);
    return acc;
  }, {});

  let detectedInsurer: string | null = null;
  for (const insurerCode of Object.keys(groups)) {
    const list = groups[insurerCode];
    if (!list || list.length === 0) continue;
    const first = list[0];
    if (!first) continue;
    const detected = detectTemplate(workbook, [
      { insurerCode: first.insurerCode, rules: first.rules },
    ]);
    if (detected) {
      detectedInsurer = insurerCode;
      break;
    }
  }

  if (!detectedInsurer) {
    return {
      status: 'NEEDS_REVIEW',
      detectedTemplate: null,
      products: [],
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

  const products: ParsedProduct[] = [];
  const matchingCandidates = groups[detectedInsurer] ?? [];
  for (const c of matchingCandidates) {
    products.push(parseProduct(workbook, c.productTypeCode, c.insurerCode, c.rules, issues));
  }

  const status: ParseResult['status'] = issues.some((i) => i.severity === 'error')
    ? 'FAILED'
    : issues.length > 0
      ? 'NEEDS_REVIEW'
      : 'PARSED';

  return {
    status,
    detectedTemplate: detectedInsurer,
    products,
    issues,
    raw: { sheets },
  };
}
