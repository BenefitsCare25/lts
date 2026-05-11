import {
  type ColumnMapping,
  UPLOAD_TEMPLATE_COLUMNS,
  applyTransform,
  buildHeaderMap,
} from '@/lib/employee-import';
import type { Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { TenantDb } from '../db/tenant';

type EmployeeUploadResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

type ParsedRow = {
  rowNumber: number;
  data: Record<string, unknown>;
  staffId: string;
  hireDate: string | null;
};

function parseRows(
  worksheet: ExcelJS.Worksheet,
  headerMap: Map<number, ColumnMapping>,
): { rows: ParsedRow[]; errors: Array<{ row: number; message: string }> } {
  const rows: ParsedRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const data: Record<string, unknown> = {};
    let staffId = '';

    headerMap.forEach((mapping, colNumber) => {
      const cellValue = row.getCell(colNumber).value;
      if (cellValue == null || String(cellValue).trim() === '') return;

      let value: unknown;
      if (mapping.transform) {
        value = applyTransform(cellValue, mapping.transform);
      } else {
        value = String(cellValue).trim();
      }

      data[mapping.fieldPath] = value;
      if (mapping.fieldPath === 'employee.staff_id') {
        staffId = String(value);
      }
    });

    if (!staffId) {
      errors.push({ row: rowNumber, message: 'Missing Staff ID' });
      return;
    }

    const fullName = data['employee.full_name'];
    if (!fullName) {
      errors.push({ row: rowNumber, message: 'Missing Employee Name' });
      return;
    }

    const hireDateRaw = data['employee.hire_date'] as string | undefined;
    rows.push({ rowNumber, data, staffId, hireDate: hireDateRaw ?? null });
  });

  return { rows, errors };
}

export async function processEmployeeUpload(
  prisma: PrismaClient | TenantDb,
  clientId: string,
  buffer: ArrayBuffer,
): Promise<EmployeeUploadResult> {
  const db = prisma as PrismaClient;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return {
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: 'No worksheet found' }],
    };
  }

  const headerRow = worksheet.getRow(1);
  const headerMap = buildHeaderMap(headerRow, UPLOAD_TEMPLATE_COLUMNS);

  if (headerMap.size === 0) {
    return {
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: 'No matching column headers found' }],
    };
  }

  const { rows, errors } = parseRows(worksheet, headerMap);
  const result: EmployeeUploadResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [...errors],
  };

  const existingEmployees = await db.employee.findMany({
    where: { clientId, status: 'ACTIVE' },
    select: { id: true, data: true },
  });

  const staffIdIndex = new Map<string, string>();
  for (const emp of existingEmployees) {
    const empData = emp.data as Record<string, unknown>;
    const sid = empData['employee.staff_id'];
    if (sid) staffIdIndex.set(String(sid), emp.id);
  }

  for (const row of rows) {
    const existingId = staffIdIndex.get(row.staffId);

    try {
      if (existingId) {
        await db.employee.update({
          where: { id: existingId },
          data: { data: row.data as Prisma.InputJsonValue },
        });
        result.updated++;
      } else {
        const hireDate = row.hireDate ? new Date(row.hireDate) : new Date();
        await db.employee.create({
          data: {
            clientId,
            data: row.data as Prisma.InputJsonValue,
            hireDate,
          },
        });
        result.created++;
      }
    } catch (err) {
      result.errors.push({
        row: row.rowNumber,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return result;
}
