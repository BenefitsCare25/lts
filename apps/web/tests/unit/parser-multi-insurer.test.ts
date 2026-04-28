// Verifies the parser dispatches across multiple insurer templates in
// one workbook (STM-style placement slip). Synthetic xlsx built in
// memory — sidesteps the .xls-format gap (deferred to Phase 2).

import { parsePlacementSlip } from '@/server/ingestion/parser';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

async function buildWorkbook(
  sheets: { name: string; cells: Record<string, unknown> }[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const def of sheets) {
    const ws = wb.addWorksheet(def.name);
    for (const [addr, value] of Object.entries(def.cells)) {
      ws.getCell(addr).value = value as ExcelJS.CellValue;
    }
  }
  // exceljs writeBuffer returns ArrayBufferLike — wrap to Node Buffer.
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

const baseGtlCells: Record<string, unknown> = {
  C4: 'STMICROELECTRONICS ASIA PACIFIC PTE LTD',
  C5: 'STM ASIA PACIFIC, STM AMK, STM TPY',
  C8: '01/01/2026 - 31/12/2026',
  C9: 'Great Eastern Life Assurance',
  C10: 'Generali Pool - Captive',
  C11: 'G0005086, G0005088, G0005089',
  C13: 'All Full Time and Permanent Employees Below Age 67',
  // Plans body — column D 21-24
  D21: 'Plan A: Hay Job Grade 16 and above',
  D22: 'Plan B: Hay Job Grade 08 to 15',
  D23: 'Plan C: Bargainable Fire Fighters / additional above Plan B',
  D24: 'Plan D: Non-bargainable Fire Fighters / additional above Plan A',
};

const baseGpaCells: Record<string, unknown> = {
  C4: 'STMICROELECTRONICS ASIA PACIFIC PTE LTD',
  C9: 'Zurich',
  C11: 'ZZG8000969SN / ZZG8000970SN',
  D20: 'Plan A: Hay Job Grade 16 and above',
  D21: 'Plan B: Hay Job Grade 08 to 15',
};

const baseGbtCells: Record<string, unknown> = {
  C4: 'STMICROELECTRONICS ASIA PACIFIC PTE LTD',
  C9: 'Chubb',
  D21: 'All job Grades, Employees on authorised Business Trips',
};

// Minimal catalogue — only the rules under test. Each rule must
// reference its own sheet so detectTemplate matches that insurer.
const STM_CATALOGUE = [
  {
    productTypeCode: 'GTL',
    rules: {
      GE_LIFE: {
        product_field_map: {
          policyholder_name: { sheet: 'GEL-GTL', cell: 'C4' },
          policy_numbers_csv: { sheet: 'GEL-GTL', cell: 'C11' },
        },
        plans_block: { sheet: 'GEL-GTL', startRow: 21, endRow: 24, codeColumn: 'D' },
        rates_block: { sheet: 'GEL-GTL', startRow: 29, endRow: 32 },
      },
    },
  },
  {
    productTypeCode: 'GPA',
    rules: {
      ZURICH: {
        product_field_map: {
          policyholder_name: { sheet: 'Zurich-GPA', cell: 'C4' },
          policy_numbers_csv: { sheet: 'Zurich-GPA', cell: 'C11' },
        },
        plans_block: { sheet: 'Zurich-GPA', startRow: 20, endRow: 23, codeColumn: 'D' },
        rates_block: { sheet: 'Zurich-GPA', startRow: 28, endRow: 31 },
      },
    },
  },
  {
    productTypeCode: 'GBT',
    rules: {
      CHUBB: {
        product_field_map: {
          policyholder_name: { sheet: ' Chubb -GBT', cell: 'C4' },
        },
        plans_block: { sheet: ' Chubb -GBT', startRow: 21, endRow: 21, codeColumn: 'D' },
        rates_block: { sheet: ' Chubb -GBT', startRow: 25, endRow: 25 },
      },
    },
  },
];

describe('parsePlacementSlip — multi-insurer dispatch', () => {
  it('parses a workbook spanning GE + Zurich + Chubb sheets and emits one product per insurer', async () => {
    const buf = await buildWorkbook([
      { name: 'GEL-GTL', cells: baseGtlCells },
      { name: 'Zurich-GPA', cells: baseGpaCells },
      { name: ' Chubb -GBT', cells: baseGbtCells },
    ]);

    const result = await parsePlacementSlip(buf, STM_CATALOGUE);

    // detectedTemplate is comma-separated — order is dictionary-order
    // over insurer codes encountered, so accept any permutation.
    const detected = (result.detectedTemplate ?? '').split(',').sort();
    expect(detected).toEqual(['CHUBB', 'GE_LIFE', 'ZURICH']);

    expect(result.products).toHaveLength(3);
    const byCode = new Map(result.products.map((p) => [p.productTypeCode, p]));
    expect(byCode.get('GTL')?.fields.policyholder_name).toContain('STMICROELECTRONICS');
    expect(byCode.get('GPA')?.fields.policyholder_name).toContain('STMICROELECTRONICS');
    expect(byCode.get('GBT')?.fields.policyholder_name).toContain('STMICROELECTRONICS');
  });

  it('extracts the GTL plan rows including the stacksOn hint in the basis text', async () => {
    const buf = await buildWorkbook([{ name: 'GEL-GTL', cells: baseGtlCells }]);
    const result = await parsePlacementSlip(buf, STM_CATALOGUE);
    const gtl = result.products.find((p) => p.productTypeCode === 'GTL');
    expect(gtl).toBeDefined();
    expect(gtl?.plans).toHaveLength(4);
    const planNames = gtl?.plans.map((p) => p.code) ?? [];
    expect(planNames[0]).toContain('Plan A');
    expect(planNames[2]).toContain('additional above Plan B');
    expect(planNames[3]).toContain('additional above Plan A');
  });

  it('skips a GE_LIFE candidate whose sheet is missing instead of emitting MISSING_SHEET noise', async () => {
    // Only Zurich and Chubb sheets present; GE_LIFE candidates should
    // be silently skipped, not produce false-positive issues.
    const buf = await buildWorkbook([
      { name: 'Zurich-GPA', cells: baseGpaCells },
      { name: ' Chubb -GBT', cells: baseGbtCells },
    ]);
    const result = await parsePlacementSlip(buf, STM_CATALOGUE);
    const codes = result.products.map((p) => p.productTypeCode).sort();
    expect(codes).toEqual(['GBT', 'GPA']);
    expect(result.issues.find((i) => i.code === 'MISSING_SHEET')).toBeUndefined();
  });

  it('returns NEEDS_REVIEW when no sheet matches any insurer template', async () => {
    const buf = await buildWorkbook([{ name: 'something-unrelated', cells: { A1: 'stuff' } }]);
    const result = await parsePlacementSlip(buf, STM_CATALOGUE);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.detectedTemplate).toBe(null);
    expect(result.issues[0]?.code).toBe('TEMPLATE_NOT_DETECTED');
  });
});
