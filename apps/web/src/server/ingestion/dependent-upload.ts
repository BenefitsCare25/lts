import {
  type ColumnMapping,
  type ColumnTransform,
  applyTransform,
  buildHeaderMap,
} from '@/lib/employee-import';
import type { Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { TenantDb } from '../db/tenant';

type DependentUploadResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  affectedEmployeeIds: string[];
};

const DEPENDENT_COLUMNS: ColumnMapping[] = [
  { header: 'Entity', fieldPath: '_meta.entity' },
  { header: 'Staff ID', fieldPath: '_lookup.staff_id', required: true },
  { header: 'Employee Name', fieldPath: '_lookup.employee_name' },
  { header: "Employee's Identification No.", fieldPath: '_lookup.employee_id_no' },
  { header: 'Dependant Name', fieldPath: 'full_name', required: true },
  { header: "Dependant's Identification No.", fieldPath: 'identification_no' },
  { header: 'Relationship', fieldPath: 'relation', required: true },
  {
    header: 'Date of Marriage',
    fieldPath: 'date_of_marriage',
    transform: 'date_dmy' as ColumnTransform,
  },
  { header: 'Gender', fieldPath: 'gender' },
  {
    header: 'Date of Birth',
    fieldPath: 'date_of_birth',
    transform: 'date_dmy' as ColumnTransform,
    required: true,
  },
  {
    header: 'Effective Date',
    fieldPath: 'effective_date',
    transform: 'date_dmy' as ColumnTransform,
  },
  {
    header: 'Termination Date',
    fieldPath: 'termination_date',
    transform: 'date_dmy' as ColumnTransform,
  },
  { header: 'Remarks', fieldPath: 'remarks' },
  { header: 'Deletion Date', fieldPath: 'deletion_date', transform: 'date_dmy' as ColumnTransform },
];

const VALID_RELATIONS = new Map([
  ['spouse', 'spouse'],
  ['wife', 'spouse'],
  ['husband', 'spouse'],
  ['child', 'child'],
  ['son', 'child'],
  ['daughter', 'child'],
]);

type ParsedDependent = {
  rowNumber: number;
  staffId: string;
  relation: string;
  data: Record<string, unknown>;
  identificationNo: string | null;
};

function parseRows(
  worksheet: ExcelJS.Worksheet,
  headerMap: Map<number, ColumnMapping>,
): { rows: ParsedDependent[]; errors: Array<{ row: number; message: string }> } {
  const rows: ParsedDependent[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const fields: Record<string, unknown> = {};
    let staffId = '';
    let relationRaw = '';

    headerMap.forEach((mapping, colNumber) => {
      const cellValue = row.getCell(colNumber).value;
      if (cellValue == null || String(cellValue).trim() === '') return;

      let value: unknown;
      if (mapping.transform) {
        value = applyTransform(cellValue, mapping.transform);
      } else {
        value = String(cellValue).trim();
      }

      fields[mapping.fieldPath] = value;

      if (mapping.fieldPath === '_lookup.staff_id') {
        staffId = String(value);
      }
      if (mapping.fieldPath === 'relation') {
        relationRaw = String(value).trim().toLowerCase();
      }
    });

    if (!staffId) {
      errors.push({ row: rowNumber, message: 'Missing Staff ID' });
      return;
    }

    if (!fields.full_name) {
      errors.push({ row: rowNumber, message: 'Missing Dependant Name' });
      return;
    }

    if (!relationRaw) {
      errors.push({ row: rowNumber, message: 'Missing Relationship' });
      return;
    }

    const relation = VALID_RELATIONS.get(relationRaw);
    if (!relation) {
      errors.push({
        row: rowNumber,
        message: `Invalid relationship: "${relationRaw}". Must be Spouse or Child`,
      });
      return;
    }

    if (!fields.date_of_birth) {
      errors.push({ row: rowNumber, message: 'Missing Date of Birth' });
      return;
    }

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!key.startsWith('_lookup.') && !key.startsWith('_meta.')) {
        data[key] = value;
      }
    }

    rows.push({
      rowNumber,
      staffId,
      relation,
      data,
      identificationNo: (fields.identification_no as string) ?? null,
    });
  });

  return { rows, errors };
}

export async function processDependentUpload(
  prisma: PrismaClient | TenantDb,
  clientId: string,
  buffer: ArrayBuffer,
): Promise<DependentUploadResult> {
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
      affectedEmployeeIds: [],
    };
  }

  const headerRow = worksheet.getRow(1);
  const headerMap = buildHeaderMap(headerRow, DEPENDENT_COLUMNS);

  if (headerMap.size === 0) {
    return {
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, message: 'No matching column headers found' }],
      affectedEmployeeIds: [],
    };
  }

  const { rows, errors } = parseRows(worksheet, headerMap);

  const employees = await db.employee.findMany({
    where: { clientId, status: 'ACTIVE' },
    select: { id: true, data: true },
  });

  const staffIdToEmployee = new Map<string, string>();
  for (const emp of employees) {
    const empData = emp.data as Record<string, unknown>;
    const sid = empData['employee.staff_id'];
    if (sid) staffIdToEmployee.set(String(sid), emp.id);
  }

  const result: DependentUploadResult = {
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [...errors],
    affectedEmployeeIds: [],
  };

  const affectedSet = new Set<string>();
  const spouseCountByEmployee = new Map<string, number>();

  const hasSpouseRows = rows.some((r) => r.relation === 'spouse');
  if (hasSpouseRows) {
    const employeeIdsInUpload = [
      ...new Set(
        rows.map((r) => staffIdToEmployee.get(r.staffId)).filter((id): id is string => id != null),
      ),
    ];
    if (employeeIdsInUpload.length > 0) {
      const existingSpouses = await db.dependent.groupBy({
        by: ['employeeId'],
        where: { employeeId: { in: employeeIdsInUpload }, relation: 'spouse' },
        _count: { id: true },
      });
      for (const row of existingSpouses) {
        spouseCountByEmployee.set(row.employeeId, row._count.id);
      }
    }
  }

  for (const row of rows) {
    const employeeId = staffIdToEmployee.get(row.staffId);
    if (!employeeId) {
      result.errors.push({
        row: row.rowNumber,
        message: `No employee found with Staff ID "${row.staffId}"`,
      });
      continue;
    }

    try {
      const existing = row.identificationNo
        ? await db.dependent.findFirst({
            where: {
              employeeId,
              data: { path: ['identification_no'], equals: row.identificationNo },
            },
          })
        : null;

      if (row.relation === 'spouse' && !existing) {
        const currentCount = spouseCountByEmployee.get(employeeId) ?? 0;
        if (currentCount >= 1) {
          result.errors.push({
            row: row.rowNumber,
            message: 'Duplicate spouse — this employee already has an active spouse',
          });
          continue;
        }
      }

      if (existing) {
        await db.dependent.update({
          where: { id: existing.id },
          data: { relation: row.relation, data: row.data as Prisma.InputJsonValue },
        });
        result.updated++;
      } else {
        await db.dependent.create({
          data: { employeeId, relation: row.relation, data: row.data as Prisma.InputJsonValue },
        });
        if (row.relation === 'spouse') {
          spouseCountByEmployee.set(employeeId, (spouseCountByEmployee.get(employeeId) ?? 0) + 1);
        }
        result.created++;
      }
      affectedSet.add(employeeId);
    } catch (err) {
      result.errors.push({
        row: row.rowNumber,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  result.affectedEmployeeIds = [...affectedSet];
  return result;
}
