// Canonical column mapping for the broker employee upload template.
//
// Maps header names from the Inspro-style Excel template to our
// employee field paths and applies any necessary transformations.
// The UI's CSV import screen uses these definitions to build the
// row-mapping step before calling importCsv.

export type ColumnTransform =
  | 'date_dmy' // "dd/mm/yyyy" → ISO date string
  | 'work_pass' // "WP" → "WORK_PERMIT", "SP" → "S_PASS", etc.
  | 'integer' // parse as integer
  | 'number' // parse as float
  | 'boolean_yn'; // "Y"/"Yes" → true, others → false

export type ColumnMapping = {
  header: string; // exact header name as it appears in the upload template
  fieldPath: string; // target field path in employee.data (dot-notation)
  transform?: ColumnTransform;
  required?: boolean;
  description?: string;
};

export type PlanOverrideColumn = {
  header: string; // e.g. "GTLEE Default Plan ID"
  productTypeCode: string; // e.g. "GTL"
};

// Maps work pass type abbreviations used in upload templates to enum values.
export function transformWorkPassType(raw: string): string {
  const normalized = raw.trim().toUpperCase();
  switch (normalized) {
    case 'WP':
    case 'WORK PERMIT':
      return 'WORK_PERMIT';
    case 'SP':
    case 'S PASS':
    case 'S-PASS':
      return 'S_PASS';
    case 'EP':
    case 'EMPLOYMENT PASS':
      return 'EP';
    case 'DP':
    case 'DEPENDANT PASS':
      return 'DEPENDANT_PASS';
    case 'PR':
    case 'PERMANENT RESIDENT':
      return 'PR';
    case 'SC':
    case 'CITIZEN':
    case 'SINGAPOREAN':
      return 'CITIZEN';
    default:
      return 'NONE';
  }
}

// Parses "dd/mm/yyyy" → ISO date string "yyyy-mm-dd".
// Returns null on parse failure.
export function parseDmy(raw: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0] ?? null;
}

// Apply a column transform to a raw cell value.
export function applyTransform(raw: unknown, transform: ColumnTransform): unknown {
  const str = raw == null ? '' : String(raw).trim();
  switch (transform) {
    case 'date_dmy':
      return parseDmy(str) ?? str;
    case 'work_pass':
      return transformWorkPassType(str);
    case 'integer': {
      const n = Number.parseInt(str, 10);
      return Number.isFinite(n) ? n : null;
    }
    case 'number': {
      const n = Number.parseFloat(str);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean_yn':
      return /^(y|yes|true|1)$/i.test(str);
  }
}

// Canonical field column mappings for the STM-style upload template.
// Additional tenant-specific columns (e.g. Hay Job Grade) should be
// appended here when known. Header names are case-insensitive matched
// in the import UI.
export const UPLOAD_TEMPLATE_COLUMNS: ColumnMapping[] = [
  { header: 'Staff ID', fieldPath: 'employee.staff_id', required: true },
  { header: 'Employee Name', fieldPath: 'employee.full_name', required: true },
  { header: 'Date of Birth', fieldPath: 'employee.date_of_birth', transform: 'date_dmy' },
  { header: 'Date of Hire', fieldPath: 'employee.hire_date', transform: 'date_dmy' },
  {
    header: 'Foreigner Employment Pass',
    fieldPath: 'employee.work_pass_type',
    transform: 'work_pass',
  },
  { header: 'Nationality', fieldPath: 'employee.nationality' },
  { header: 'Monthly Salary', fieldPath: 'employee.last_drawn_salary', transform: 'number' },
  { header: 'Hay Job Grade', fieldPath: 'employee.hay_job_grade' },
  { header: 'Employment Class', fieldPath: 'employee.employment_type' },
  { header: 'Salary Band Override', fieldPath: 'employee.salary_band_override' },
  { header: 'Marital Status', fieldPath: 'employee.marital_status' },
  { header: 'Entity', fieldPath: 'employee.entity' },
  { header: 'Division', fieldPath: 'employee.division' },
  { header: 'Department', fieldPath: 'employee.department' },
  { header: 'Cost Centre', fieldPath: 'employee.cost_centre' },
  { header: 'Identification No.', fieldPath: 'employee.identification_no' },
  { header: 'Gender', fieldPath: 'employee.gender' },
  { header: 'Confirmation Date', fieldPath: 'employee.confirmation_date', transform: 'date_dmy' },
  { header: 'Email Address', fieldPath: 'employee.email' },
  { header: 'Mobile Phone', fieldPath: 'employee.mobile_phone' },
  { header: 'Bank Code', fieldPath: 'employee.bank_code' },
  { header: 'Branch Code', fieldPath: 'employee.branch_code' },
  { header: 'Bank Account No.', fieldPath: 'employee.bank_account_no' },
  { header: 'Category', fieldPath: 'employee.category' },
];

// Shared header-to-column map builder used by employee and dependent upload parsers.
// Case-insensitive header matching.
export function buildHeaderMap(
  headerRow: import('exceljs').Row,
  columns: ColumnMapping[],
): Map<number, ColumnMapping> {
  const map = new Map<number, ColumnMapping>();
  const headerLookup = new Map(columns.map((c) => [c.header.toLowerCase(), c]));

  headerRow.eachCell((cell, colNumber) => {
    const headerText = String(cell.value ?? '')
      .trim()
      .toLowerCase();
    const mapping = headerLookup.get(headerText);
    if (mapping) map.set(colNumber, mapping);
  });

  return map;
}

// Plan override columns — values are raw Inspro plan codes (e.g. "24x", "B").
// Stored in employee.data._plan_overrides.{productTypeCode} during import for
// later reconciliation when enrollments are created.
export const PLAN_OVERRIDE_COLUMNS: PlanOverrideColumn[] = [
  { header: 'GTLEE Default Plan ID', productTypeCode: 'GTL' },
  { header: 'GPAEE Default Plan ID', productTypeCode: 'GPA' },
  { header: 'GHS Default Plan ID', productTypeCode: 'GHS' },
  { header: 'GOSP Default Plan ID', productTypeCode: 'GOSP' },
  { header: 'GCIEE Default Plan ID', productTypeCode: 'GCI' },
];
