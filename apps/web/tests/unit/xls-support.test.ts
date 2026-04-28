// Verifies the .xls → .xlsx normalisation path. Builds a synthetic
// .xls in memory via SheetJS, runs it through `normalizeToXlsxBuffer`,
// then feeds the result through the full `parsePlacementSlip`
// pipeline that the upload route uses.
//
// This is the only test that exercises SheetJS directly; the rest of
// the test suite stays on exceljs. See xls-to-xlsx.ts for why we keep
// SheetJS confined.

import { parsePlacementSlip } from '@/server/ingestion/parser';
import { detectFormat, normalizeToXlsxBuffer } from '@/server/ingestion/xls-to-xlsx';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

function buildXls(sheets: { name: string; rows: unknown[][] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const def of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(def.rows);
    XLSX.utils.book_append_sheet(wb, ws, def.name);
  }
  // bookType 'biff8' = the canonical .xls binary format.
  const out = XLSX.write(wb, { bookType: 'biff8', type: 'buffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

describe('detectFormat', () => {
  it('identifies the ZIP magic header as xlsx', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(detectFormat(buf)).toBe('xlsx');
  });

  it('identifies the CFB / OLE2 magic header as xls', () => {
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(detectFormat(buf)).toBe('xls');
  });

  it('returns unknown for anything else', () => {
    expect(detectFormat(Buffer.from('hello world'))).toBe('unknown');
    expect(detectFormat(Buffer.from([0xff, 0xff]))).toBe('unknown');
  });
});

describe('normalizeToXlsxBuffer', () => {
  it('passes .xlsx bytes through untouched', () => {
    const xlsxIn = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);
    const out = normalizeToXlsxBuffer(xlsxIn);
    expect(out).toBe(xlsxIn);
  });

  it('converts .xls bytes to valid .xlsx bytes (ZIP signature)', () => {
    const xlsBuf = buildXls([{ name: 'Sheet1', rows: [['a', 'b']] }]);
    expect(detectFormat(xlsBuf)).toBe('xls');
    const out = normalizeToXlsxBuffer(xlsBuf);
    expect(detectFormat(out)).toBe('xlsx');
  });

  it('throws on unknown formats', () => {
    expect(() => normalizeToXlsxBuffer(Buffer.from('not excel'))).toThrow(
      /not a recognised Excel workbook/,
    );
  });
});

describe('parsePlacementSlip — end-to-end .xls', () => {
  // Mirror the GE_LIFE GTL fixture from parser-multi-insurer.test.ts but
  // start from .xls bytes to prove the normalisation path lights up
  // the same downstream parser code.
  const stmRows: unknown[][] = [
    // Row 1: title
    ['Group Term Life'],
    // Row 2: blank
    [],
    // Row 3: NA
    ['Group :', '', 'NA'],
    ['Policyholder :', '', 'STMICROELECTRONICS ASIA PACIFIC PTE LTD'],
    ['Insured :', '', 'STM ASIA PACIFIC, STM AMK, STM TPY'],
    ['Office Address :', '', '5A Serangoon North Avenue 5'],
    ['Business :', '', 'WHOLESALE OF ELECTRONIC COMPONENTS'],
    ['Period of Insurance :', '', '01/01/2026 - 31/12/2026'],
    ['Insurer :', '', 'Great Eastern Life Assurance'],
    ['Pool :', '', 'Generali Pool - Captive'],
    ['Policy No. :', '', 'G0005086, G0005088, G0005089'],
    [],
    ['Eligibility :', '', 'All Full Time and Permanent Employees Below Age 67'],
    ['Eligibility Date :', '', 'Upon employment'],
    ['Last entry age :', '', '66 next birthday'],
    [],
    ['Type of Administration :', '', 'Headcount basis'],
    [],
    ['Basis of Cover :'],
    [],
    // Row 21+: plans rows; column D = index 3 in 0-indexed AOA
    ['', '', '', 'Plan A: Hay Job Grade 16 and above'],
    ['', '', '', 'Plan B: Hay Job Grade 08 to 15'],
    ['', '', '', 'Plan C: Bargainable Fire Fighters / additional above Plan B'],
    ['', '', '', 'Plan D: Non-bargainable Fire Fighters / additional above Plan A'],
  ];

  const STM_GTL_CATALOGUE = [
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
  ];

  it('parses an .xls workbook through the same pipeline as .xlsx', async () => {
    const xlsBytes = buildXls([{ name: 'GEL-GTL', rows: stmRows }]);
    const result = await parsePlacementSlip(xlsBytes, STM_GTL_CATALOGUE);

    expect(result.status).not.toBe('FAILED');
    expect(result.detectedTemplate).toBe('GE_LIFE');
    expect(result.products).toHaveLength(1);
    const gtl = result.products[0];
    expect(gtl?.fields.policyholder_name).toContain('STMICROELECTRONICS');
    expect(gtl?.fields.policy_numbers_csv).toContain('G0005086');
    expect(gtl?.plans).toHaveLength(4);
    expect(gtl?.plans[2]?.code).toContain('additional above Plan B');
    expect(gtl?.plans[3]?.code).toContain('additional above Plan A');
  });

  it('rejects garbage with a clean FAILED status, not an exception', async () => {
    const result = await parsePlacementSlip(Buffer.from('definitely not excel'), STM_GTL_CATALOGUE);
    expect(result.status).toBe('FAILED');
    expect(result.issues[0]?.code).toBe('NOT_AN_EXCEL_FILE');
  });
});
