// Extracts unique employee category labels from an employee listing workbook.
//
// Scans the first worksheet for a column whose header matches "category"
// (case-insensitive, trimmed). Returns a sorted, deduplicated array of
// non-empty string cell values from that column.
//
// Used by the import wizard to feed ground-truth employee categories into
// the AI extraction prompt so the AI names benefit groups using the exact
// labels that employees will have in their data — enabling simple
// `{ "==": [{ "var": "employee.category" }, "Director"] }` predicates
// rather than inferred Hay Grade / work-pass comparisons.

import ExcelJS from 'exceljs';

export class CategoryColumnNotFoundError extends Error {
  constructor() {
    super(
      'No "Category" column found in the uploaded file. ' +
        'The first row must contain a header cell with the text "Category".',
    );
    this.name = 'CategoryColumnNotFoundError';
  }
}

export async function extractUniqueCategories(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS typings lag behind Node 22's generic Buffer type — cast to satisfy overload.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new CategoryColumnNotFoundError();
  }

  // Find the column index for "Category" by scanning the first (header) row.
  const headerRow = sheet.getRow(1);
  let categoryColIndex: number | null = null;

  headerRow.eachCell((cell, colNumber) => {
    if (categoryColIndex !== null) return;
    const raw = cell.value;
    const text = raw == null ? '' : String(raw).trim().toLowerCase();
    if (text === 'category') {
      categoryColIndex = colNumber;
    }
  });

  if (categoryColIndex === null) {
    throw new CategoryColumnNotFoundError();
  }

  const seen = new Set<string>();
  const col = categoryColIndex;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const cell = row.getCell(col);
    const raw = cell.value;
    if (raw == null) return;
    const text = String(raw).trim();
    if (text.length > 0) seen.add(text);
  });

  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}
