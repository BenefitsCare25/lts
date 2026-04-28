// Verifies the workbook-level extras: PolicyEntity extraction,
// multi-block rates, and benefit-group predicate inference.

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
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

describe('parsePlacementSlip — PolicyEntity extraction', () => {
  it('extracts entities from the comments sheet and flags the master row', async () => {
    const buf = await buildWorkbook([
      {
        name: 'comments',
        cells: {
          A21: 'G0005086',
          B21: 'STMICROELECTRONICS ASIA PACIFIC PTE LTD',
          A22: 'G0005088',
          B22: 'STMICROELECTRONICS PTE LTD AMK',
          A23: 'G0005089',
          B23: 'STMICROELECTRONICS PTE LTD TPY',
        },
      },
      // A real product sheet so the template detector accepts the workbook.
      { name: 'GEL-GTL', cells: { C4: 'STM Asia Pacific', D21: 'Plan A' } },
    ]);

    const result = await parsePlacementSlip(buf, [
      {
        productTypeCode: 'GTL',
        rules: {
          GE_LIFE: {
            product_field_map: { policyholder_name: { sheet: 'GEL-GTL', cell: 'C4' } },
            plans_block: { sheet: 'GEL-GTL', startRow: 21, endRow: 21, codeColumn: 'D' },
            rates_block: { sheet: 'GEL-GTL', startRow: 30, endRow: 30 },
            policy_entities_block: {
              sheet: 'comments',
              startRow: 21,
              endRow: 23,
              policyNumberColumn: 'A',
              legalNameColumn: 'B',
              masterRow: 21,
            },
          },
        },
      },
    ]);

    expect(result.policyEntities).toHaveLength(3);
    expect(result.policyEntities[0]).toEqual({
      policyNumber: 'G0005086',
      legalName: 'STMICROELECTRONICS ASIA PACIFIC PTE LTD',
      isMaster: true,
    });
    expect(result.policyEntities[1]?.isMaster).toBe(false);
    expect(result.policyEntities[2]?.isMaster).toBe(false);
  });

  it('returns empty entities array when no rule declares the block', async () => {
    const buf = await buildWorkbook([{ name: 'GEL-GTL', cells: { C4: 'Acme', D21: 'Plan A' } }]);
    const result = await parsePlacementSlip(buf, [
      {
        productTypeCode: 'GTL',
        rules: {
          GE_LIFE: {
            product_field_map: { policyholder_name: { sheet: 'GEL-GTL', cell: 'C4' } },
            plans_block: { sheet: 'GEL-GTL', startRow: 21, endRow: 21, codeColumn: 'D' },
            rates_block: { sheet: 'GEL-GTL', startRow: 30, endRow: 30 },
          },
        },
      },
    ]);
    expect(result.policyEntities).toEqual([]);
  });
});

describe('parsePlacementSlip — rider-stack detection', () => {
  it('extracts stacksOnLabel from "additional above Plan X" text', async () => {
    const buf = await buildWorkbook([
      {
        name: 'GEL-GTL',
        cells: {
          C4: 'Acme',
          D21: 'Plan A: Senior',
          D22: 'Plan B: Mid',
          D23: 'Plan C: Bargainable Fire Fighters / additional above Plan B',
          D24: 'Plan D: Non-bargainable Fire Fighters / additional above Plan A',
        },
      },
    ]);
    const result = await parsePlacementSlip(buf, [
      {
        productTypeCode: 'GTL',
        rules: {
          GE_LIFE: {
            product_field_map: { policyholder_name: { sheet: 'GEL-GTL', cell: 'C4' } },
            plans_block: { sheet: 'GEL-GTL', startRow: 21, endRow: 24, codeColumn: 'D' },
            rates_block: { sheet: 'GEL-GTL', startRow: 30, endRow: 30 },
          },
        },
      },
    ]);
    const gtl = result.products[0];
    expect(gtl?.plans[0]?.stacksOnLabel).toBeUndefined();
    expect(gtl?.plans[1]?.stacksOnLabel).toBeUndefined();
    expect(gtl?.plans[2]?.stacksOnLabel).toBe('Plan B');
    expect(gtl?.plans[3]?.stacksOnLabel).toBe('Plan A');
  });
});

describe('parsePlacementSlip — multi-block rates', () => {
  it('emits one rate row per block with _blockIndex tags', async () => {
    const buf = await buildWorkbook([
      {
        name: 'Allianz-WICI',
        cells: {
          C4: 'STM Asia Pacific',
          D21: 'Non-Manual Employees',
          // Block 0: rows 30-31
          D30: 'Block 0 Row A',
          D31: 'Block 0 Row B',
          // Block 1: rows 35-36
          D35: 'Block 1 Row A',
          D36: 'Block 1 Row B',
        },
      },
    ]);

    const result = await parsePlacementSlip(buf, [
      {
        productTypeCode: 'WICI',
        rules: {
          ALLIANZ: {
            product_field_map: { policyholder_name: { sheet: 'Allianz-WICI', cell: 'C4' } },
            plans_block: { sheet: 'Allianz-WICI', startRow: 21, endRow: 21, codeColumn: 'D' },
            rates_blocks: {
              sheet: 'Allianz-WICI',
              blocks: [
                { startRow: 30, endRow: 31, label: 'Asia Pacific' },
                { startRow: 35, endRow: 36, label: 'AMK' },
              ],
            },
          },
        },
      },
    ]);

    const wici = result.products[0];
    expect(wici).toBeDefined();
    expect(wici?.rates).toHaveLength(4);
    expect(wici?.rates[0]?._blockIndex).toBe(0);
    expect(wici?.rates[0]?._blockLabel).toBe('Asia Pacific');
    expect(wici?.rates[2]?._blockIndex).toBe(1);
    expect(wici?.rates[2]?._blockLabel).toBe('AMK');
  });
});

describe('parsePlacementSlip — benefit-group predicate inference', () => {
  async function parseGroups(planNames: string[]) {
    const cells: Record<string, unknown> = { C4: 'Acme' };
    planNames.forEach((name, i) => {
      cells[`D${21 + i}`] = name;
    });
    const buf = await buildWorkbook([{ name: 'GEL-GHS', cells }]);
    return parsePlacementSlip(buf, [
      {
        productTypeCode: 'GHS',
        rules: {
          GE_LIFE: {
            product_field_map: { policyholder_name: { sheet: 'GEL-GHS', cell: 'C4' } },
            plans_block: {
              sheet: 'GEL-GHS',
              startRow: 21,
              endRow: 21 + planNames.length - 1,
              codeColumn: 'D',
            },
            rates_block: { sheet: 'GEL-GHS', startRow: 30, endRow: 30 },
          },
        },
      },
    ]);
  }

  it('infers >=N for "Hay Job Grade N and above"', async () => {
    const result = await parseGroups(['Hay Job Grade 18 and above']);
    const group = result.benefitGroups[0];
    expect(group?.predicate).toEqual({ '>=': [{ var: 'employee.hay_job_grade' }, 18] });
    expect(group?.confidence).toBe(1);
  });

  it('infers a range for "Hay Job Grade 08 to 15"', async () => {
    const result = await parseGroups(['Hay Job Grade 08 to 15 and Bargainable Staff']);
    const group = result.benefitGroups[0];
    // Both range predicate and bargainable token match — combined under `and`.
    expect(group?.confidence).toBeGreaterThanOrEqual(2);
    expect(group?.predicate).toHaveProperty('and');
  });

  it('infers FW work_pass_type IN [WP, SP] for "Foreign Workers WP/SP"', async () => {
    const result = await parseGroups([
      'Foreign Workers holding Work Permit or S-Pass with Hay Job Grade 18 and above',
    ]);
    const group = result.benefitGroups[0];
    // FW + HJG range = 2 matches, combined under `and`.
    expect(group?.confidence).toBeGreaterThanOrEqual(2);
    const json = JSON.stringify(group?.predicate);
    expect(json).toContain('work_pass_type');
    expect(json).toContain('hay_job_grade');
  });

  it('returns confidence=0 with empty predicate for unrecognised text', async () => {
    const result = await parseGroups(['Some entirely unrelated description with no domain hints']);
    const group = result.benefitGroups[0];
    expect(group?.confidence).toBe(0);
    expect(group?.predicate).toEqual({});
  });

  it('flattens nested `and` predicates', async () => {
    const result = await parseGroups([
      'Foreign Workers WP/SP with Hay Job Grade 08 to 15 and Bargainable',
    ]);
    const group = result.benefitGroups[0];
    // Expect a single flat `and` array, not nested.
    const json = JSON.stringify(group?.predicate);
    const nestedAnd = json.match(/"and":\s*\[\s*\{\s*"and":/);
    expect(nestedAnd).toBeNull();
  });

  it('de-duplicates identical labels across products', async () => {
    const buf = await buildWorkbook([
      {
        name: 'GEL-GHS',
        cells: { C4: 'Acme', D21: 'Hay Job Grade 18 and above' },
      },
      {
        name: 'GEL-GMM',
        cells: { C4: 'Acme', D22: 'Hay Job Grade 18 and above' },
      },
    ]);
    const result = await parsePlacementSlip(buf, [
      {
        productTypeCode: 'GHS',
        rules: {
          GE_LIFE: {
            product_field_map: { policyholder_name: { sheet: 'GEL-GHS', cell: 'C4' } },
            plans_block: { sheet: 'GEL-GHS', startRow: 21, endRow: 21, codeColumn: 'D' },
            rates_block: { sheet: 'GEL-GHS', startRow: 30, endRow: 30 },
          },
        },
      },
      {
        productTypeCode: 'GMM',
        rules: {
          GE_LIFE: {
            product_field_map: { policyholder_name: { sheet: 'GEL-GMM', cell: 'C4' } },
            plans_block: { sheet: 'GEL-GMM', startRow: 22, endRow: 22, codeColumn: 'D' },
            rates_block: { sheet: 'GEL-GMM', startRow: 30, endRow: 30 },
          },
        },
      },
    ]);
    expect(result.benefitGroups).toHaveLength(1);
  });
});
