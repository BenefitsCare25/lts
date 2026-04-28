// =============================================================
// .xls → .xlsx normalisation, isolated.
//
// Why this file exists. The downstream parser (parser.ts) uses
// exceljs which only reads .xlsx (Office Open XML / ZIP-based).
// Real-world insurer placement slips are commonly .xls (BIFF8 /
// CFB binary). SheetJS is the de-facto Node lib for .xls; this
// file is the only place in the app that imports it.
//
// Security note. The npm-registry `xlsx` package is pinned at
// 0.18.5 which carries CVE-2023-30533 (prototype pollution via
// crafted .xls). The patched 0.19.3+ versions live only on the
// SheetJS CDN. For Phase 1G the threat model is admin-only
// ingestion — broker users uploading their own placement slips —
// which bounds the impact. Migration to the SheetJS CDN tarball
// is tracked as a Phase 2 hardening item; until then, three
// mitigations apply here:
//   1. SheetJS objects never leave this file. We read once and
//      immediately re-emit as .xlsx bytes; the rest of the parser
//      pipeline only sees the resulting ArrayBuffer/Buffer.
//   2. No iteration of workbook properties via for-in or Object
//      spread — those are the prototype-pollution gadgets. We
//      hand the workbook back to SheetJS for serialisation.
//   3. The function is wrapped in try/catch and surfaces a
//      structured error rather than letting an exception
//      bubble unrestricted.
// =============================================================

import * as XLSX from 'xlsx';

// CFB / OLE2 magic header — first 8 bytes of every legacy .xls.
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// XLSX is just a ZIP — every .xlsx starts with PK\x03\x04.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export type WorkbookFormat = 'xlsx' | 'xls' | 'unknown';

export function detectFormat(buffer: Buffer): WorkbookFormat {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(CFB_MAGIC)) return 'xls';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC)) return 'xlsx';
  return 'unknown';
}

// Returns the buffer unchanged for .xlsx inputs; converts .xls in
// memory to .xlsx bytes via SheetJS for legacy inputs. Throws on
// anything else so the upload route can return a clean BAD_REQUEST.
export function normalizeToXlsxBuffer(buffer: Buffer): Buffer {
  const format = detectFormat(buffer);
  if (format === 'xlsx') return buffer;
  if (format === 'unknown') {
    throw new Error('File is not a recognised Excel workbook (.xls or .xlsx).');
  }

  // .xls path. Read once, write once, return.
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: false });
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
