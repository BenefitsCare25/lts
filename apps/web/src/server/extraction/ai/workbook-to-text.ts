// =============================================================
// Workbook → text serializer for the AI extraction layer.
//
// LLMs cannot parse .xlsx bytes. We turn each sheet into a compact
// markdown block whose every populated cell is prefixed with its A1
// reference, e.g. `B12: Tokio Marine Life`. This lets the model cite
// exact cell coordinates in the `sourceRef` envelope without us
// having to post-process its output.
//
// Why one block per sheet (not one big table):
//   - Sheets carry semantic meaning ("GHS - Locals" vs "GHS -
//     Dependants" — same product type, different population).
//   - Markdown table parsing is fragile when sheets have variable
//     column counts; a key:value list is more robust.
//
// Size cap:
//   - We emit at most ~150k characters total (≈ 40k input tokens
//     after prompt overhead). Real placement slips average 30–80k
//     chars; the pathological 200-sheet workbook is truncated and
//     a warning is recorded so the broker sees what was skipped.
// =============================================================

import { normalizeToXlsxBuffer } from '@/server/ingestion/xls-to-xlsx';
import ExcelJS from 'exceljs';

// 150_000 chars ≈ 40k tokens of body + headroom for the system
// preamble and tool-schema. Claude 4.6 / GPT-4.1 both handle 200k
// inputs comfortably so this leaves headroom for the prompt.
const MAX_TOTAL_CHARS = 150_000;
// Per-cell cap. Free-text cells (eligibility paragraphs, comments)
// occasionally run multi-paragraph; trim to keep the matrix scannable.
const MAX_CELL_CHARS = 800;
// Per-sheet row cap. Rate matrices can be 500+ rows; we keep the
// first N and emit an ellipsis with a count.
const MAX_ROWS_PER_SHEET = 200;
// Per-sheet column cap. Most slips use cols A–P; some have hidden
// formula columns out to AZ. Cap at 40 to bound the row width.
const MAX_COLS_PER_SHEET = 40;

export type WorkbookText = {
  sheets: Array<{
    name: string;
    rowCount: number;
    truncatedRows: boolean;
    text: string;
  }>;
  totalChars: number;
  truncated: boolean;
  truncatedSheetCount: number;
  warnings: string[];
};

export async function workbookToText(buffer: Buffer): Promise<WorkbookText> {
  // Reuse the same normaliser the heuristic parser uses — converts
  // legacy .xls to .xlsx in-memory, no-op on .xlsx.
  const xlsxBuffer = normalizeToXlsxBuffer(buffer);
  const workbook = new ExcelJS.Workbook();
  // exceljs's `load` wants an ArrayBuffer; the Node Buffer slice is
  // the cheapest way across the type boundary (same pattern parser.ts
  // uses for the heuristic path).
  const arrayBuffer = xlsxBuffer.buffer.slice(
    xlsxBuffer.byteOffset,
    xlsxBuffer.byteOffset + xlsxBuffer.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);

  const sheets: WorkbookText['sheets'] = [];
  const warnings: string[] = [];
  let totalChars = 0;
  let truncated = false;
  let truncatedSheetCount = 0;

  for (const ws of workbook.worksheets) {
    if (totalChars >= MAX_TOTAL_CHARS) {
      truncated = true;
      truncatedSheetCount++;
      continue;
    }
    const remaining = MAX_TOTAL_CHARS - totalChars;
    const result = sheetToMarkdown(ws, remaining);
    if (result.bytesTruncated) truncated = true;
    sheets.push({
      name: ws.name,
      rowCount: result.rowCount,
      truncatedRows: result.truncatedRows,
      text: result.text,
    });
    totalChars += result.text.length;
    if (result.warning) warnings.push(`[${ws.name}] ${result.warning}`);
  }

  if (truncated) {
    warnings.unshift(
      `Workbook truncated to fit AI input cap (${MAX_TOTAL_CHARS.toLocaleString()} chars). ${truncatedSheetCount} trailing sheet${truncatedSheetCount === 1 ? '' : 's'} skipped.`,
    );
  }

  return { sheets, totalChars, truncated, truncatedSheetCount, warnings };
}

function sheetToMarkdown(
  ws: ExcelJS.Worksheet,
  remainingChars: number,
): {
  text: string;
  rowCount: number;
  truncatedRows: boolean;
  bytesTruncated: boolean;
  warning: string | null;
} {
  const lines: string[] = [];
  lines.push(`## Sheet: ${ws.name}`);
  lines.push('');

  const lastRow = Math.min(ws.actualRowCount ?? ws.rowCount ?? 0, MAX_ROWS_PER_SHEET);
  const truncatedRows = (ws.actualRowCount ?? ws.rowCount ?? 0) > MAX_ROWS_PER_SHEET;
  const lastCol = Math.min(ws.actualColumnCount ?? ws.columnCount ?? 0, MAX_COLS_PER_SHEET);

  if (lastRow === 0 || lastCol === 0) {
    lines.push('_(empty)_');
    lines.push('');
    return {
      text: lines.join('\n'),
      rowCount: 0,
      truncatedRows: false,
      bytesTruncated: false,
      warning: null,
    };
  }

  // Walk row by row, emitting only populated cells. The format is:
  //   A1: header
  //   B1: header
  //   ---
  //   A2: value
  //   B2: value
  // Each row separated by blank line for the model's parser. Empty
  // cells are omitted to compact the input dramatically — slips are
  // ~80% sparse on average.
  let bytesTruncated = false;
  let runningChars = lines.join('\n').length;

  for (let rowIdx = 1; rowIdx <= lastRow; rowIdx++) {
    if (runningChars >= remainingChars) {
      bytesTruncated = true;
      lines.push(
        `_(remaining rows truncated; sheet has ${ws.actualRowCount ?? ws.rowCount ?? '?'} rows total)_`,
      );
      break;
    }
    const row = ws.getRow(rowIdx);
    const rowLines: string[] = [];
    for (let colIdx = 1; colIdx <= lastCol; colIdx++) {
      const cell = row.getCell(colIdx);
      const text = cellToText(cell);
      if (text === '') continue;
      const a1 = `${columnLetter(colIdx)}${rowIdx}`;
      const trimmed = text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
      rowLines.push(`${a1}: ${trimmed}`);
    }
    if (rowLines.length > 0) {
      const block = rowLines.join('\n');
      runningChars += block.length + 2; // +2 for newline+blank-line separator
      lines.push(block);
      lines.push('');
    }
  }

  let warning: string | null = null;
  if (truncatedRows && !bytesTruncated) {
    warning = `Showing first ${MAX_ROWS_PER_SHEET} rows of ${ws.actualRowCount ?? ws.rowCount ?? '?'}.`;
  }

  return {
    text: lines.join('\n'),
    rowCount: lastRow,
    truncatedRows,
    bytesTruncated,
    warning,
  };
}

// Cells are unions of strings, numbers, dates, formulas (with cached
// values), errors, and rich-text. We coerce each shape to a stable
// stringified form so the same cell renders identically on every run.
//
// Sentinel returns:
//   '#ERR'      — Excel error cell (e.g. #REF!, #N/A)
//   '#FORMULA'  — formula present but no cached result (workbook never
//                 calculated; LibreOffice/exceljs cannot evaluate
//                 cross-sheet refs at load time). The model treats this
//                 as "value is in the formula text but not extractable".
//   '#UNKNOWN'  — exceljs returned a shape we don't recognise. Better to
//                 surface a sentinel than render `[object Object]`,
//                 which the LLM has been observed to copy verbatim into
//                 its narrative warnings.
function cellToText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    // Excel often stores dates as serial numbers; if the cell carries
    // the date numFmt the formatted text gives us a nicer representation.
    const fmt = (cell as { numFmt?: string }).numFmt;
    if (fmt && /[ymd]/i.test(fmt)) {
      try {
        const date = excelSerialToDate(v);
        if (date) return date.toISOString().slice(0, 10);
      } catch {
        /* fall through to numeric */
      }
    }
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== 'object') return String(v).trim();

  // Rich-text — concat the runs.
  if ('richText' in v && Array.isArray(v.richText)) {
    return v.richText
      .map((run) => (run as { text?: unknown }).text ?? '')
      .join('')
      .trim();
  }
  // Errors — render as `#ERR` so the model knows the cell isn't blank
  // but also isn't trustworthy. Checked before formula because some
  // error cells carry a `formula` field too.
  if ('error' in v) return '#ERR';
  // Formula — prefer the cached result. ExcelJS represents this as
  // `{ formula | sharedFormula, result?: ... }`. If the workbook was
  // saved without recomputation (very common for `.xls` files round-
  // tripped through LibreOffice), `result` is undefined and we surface
  // a sentinel rather than the stringified formula object.
  if ('formula' in v || 'sharedFormula' in v) {
    if ('result' in v && v.result != null) {
      return cellToText({
        value: v.result,
        numFmt: (cell as { numFmt?: string }).numFmt,
      } as ExcelJS.Cell);
    }
    const formulaText =
      typeof (v as { formula?: unknown }).formula === 'string'
        ? `=${(v as { formula: string }).formula}`
        : typeof (v as { sharedFormula?: unknown }).sharedFormula === 'string'
          ? `=${(v as { sharedFormula: string }).sharedFormula}`
          : '';
    return formulaText ? `#FORMULA(${formulaText})` : '#FORMULA';
  }
  // Hyperlink — show the visible text.
  if ('text' in v && typeof (v as { text?: unknown }).text === 'string') {
    return ((v as { text: string }).text as string).trim();
  }
  // Last resort: shape we don't recognise. Avoid `[object Object]`.
  return '#UNKNOWN';
}

// 1 → "A", 27 → "AA", 702 → "ZZ". Excel's column lettering.
function columnLetter(index: number): string {
  let n = index;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Excel's day-zero is 1899-12-30 (with a Lotus 1-2-3 1900-leap-year
// quirk). Convert a serial number to a UTC Date.
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const utcMillis = (serial - 25569) * 86_400_000;
  const date = new Date(utcMillis);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// Build the final concatenated prompt body that the runner hands to
// the model. Sheets are joined with a separator the prompt explicitly
// mentions, so the model knows where one sheet ends and another begins.
export function flattenWorkbookText(text: WorkbookText): string {
  const head: string[] = [];
  if (text.warnings.length > 0) {
    head.push('## Notes from the workbook serializer');
    for (const w of text.warnings) head.push(`- ${w}`);
    head.push('');
  }
  const body = text.sheets.map((s) => s.text).join('\n\n---\n\n');
  return head.length > 0 ? `${head.join('\n')}\n${body}` : body;
}

// Return a flattened string containing only the named sheets. The
// runner calls this once per manifest entry using anchorSheets from
// the discovery pass, so each per-product call receives a focused
// slice of the workbook (~10-25k chars) rather than the full 150k.
// Falls back to the full text when no names match (e.g. anchorSheets
// is empty or uses a different capitalisation than the serializer).
export function filterWorkbookText(text: WorkbookText, sheetNames: string[]): string {
  if (sheetNames.length === 0) return flattenWorkbookText(text);
  const lower = new Set(sheetNames.map((s) => s.trim().toLowerCase()));
  const matched = text.sheets.filter((s) => lower.has(s.name.trim().toLowerCase()));
  if (matched.length === 0) return flattenWorkbookText(text);
  return flattenWorkbookText({ ...text, sheets: matched });
}
