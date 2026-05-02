// Canonical column mapping for the broker employee upload template.
//
// Maps header names from the Inspro-style Excel template to our
// employee field paths and applies any necessary transformations.
// The UI's CSV import screen uses these definitions to build the
// row-mapping step before calling importCsv.

export type ColumnTransform =
  | 'date_dmy'      // "dd/mm/yyyy" → ISO date string
  | 'work_pass'     // "WP" → "WORK_PERMIT", "SP" → "S_PASS", etc.
  | 'integer'       // parse as integer
  | 'number'        // parse as float
  | 'boolean_yn';   // "Y"/"Yes" → true, others → false

export type ColumnMapping = {
  header: string;           // exact header name as it appears in the upload template
  fieldPath: string;        // target field path in employee.data (dot-notation)
  transform?: ColumnTransform;
  required?: boolean;
  description?: string;
};

export type PlanOverrideColumn = {
  header: string;           // e.g. "GTLEE Default Plan ID"
  productTypeCode: string;  // e.g. "GTL"
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
  {
    header: 'Employee Name',
    fieldPath: 'employee.full_name',
    required: true,
  },
  {
    header: 'Date of Birth',
    fieldPath: 'employee.date_of_birth',
    transform: 'date_dmy',
  },
  {
    header: 'Date of Hire',
    fieldPath: 'employee.hire_date',
    transform: 'date_dmy',
  },
  {
    header: 'Foreigner Employment Pass',
    fieldPath: 'employee.work_pass_type',
    transform: 'work_pass',
  },
  {
    header: 'Nationality',
    fieldPath: 'employee.nationality',
    description: 'ISO nationality code; broker normalises to EmployeeSchema enum',
  },
  {
    header: 'Monthly Salary',
    fieldPath: 'employee.last_drawn_salary',
    transform: 'number',
  },
  {
    header: 'Hay Job Grade',
    fieldPath: 'employee.hay_job_grade',
    transform: 'integer',
    description: 'Broker adds this column; maps to STANDARD field for predicate evaluation',
  },
  {
    header: 'Staff ID',
    fieldPath: 'employee.staff_id',
    description: 'Custom field — broker must add to EmployeeSchema before import',
  },
];

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
