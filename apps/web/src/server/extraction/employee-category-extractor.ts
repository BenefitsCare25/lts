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

  // getRow(1).values is a 1-based sparse array; findIndex short-circuits unlike eachCell.
  const headerValues = sheet.getRow(1).values as (ExcelJS.CellValue | undefined)[];
  const categoryColIndex = headerValues.findIndex(
    (v) => v != null && String(v).trim().toLowerCase() === 'category',
  );

  if (categoryColIndex === -1) {
    throw new CategoryColumnNotFoundError();
  }

  const seen = new Set<string>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = row.getCell(categoryColIndex);
    const raw = cell.value;
    if (raw == null) return;
    const text = String(raw).trim();
    if (text.length > 0) seen.add(text);
  });

  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}
