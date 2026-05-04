// =============================================================
// Employee Schema — per-tenant field catalogue.
//
// Three tiers (per v2 plan §3.3):
//   BUILTIN  — five system fields, always present, never removable.
//   STANDARD — common HR fields, toggleable on/off via `enabled`.
//   CUSTOM   — tenant-specific fields, full CRUD via Screen 0a.
//
// Stored as a single JSON array on EmployeeSchema.fields. The
// `tier` discriminator is the source of truth for which controls
// the editor renders.
// =============================================================

// Zod validators live in the app's tRPC router — keeping them out
// of shared-types avoids the dual-package zod brand collision that
// breaks tRPC's input type inference across workspace boundaries.

export const FIELD_DATA_TYPES = ['string', 'integer', 'number', 'boolean', 'date', 'enum'] as const;
export type FieldDataType = (typeof FIELD_DATA_TYPES)[number];

export const FIELD_TIERS = ['BUILTIN', 'STANDARD', 'CUSTOM'] as const;
export type FieldTier = (typeof FIELD_TIERS)[number];

// Field shape (shared between server validation and UI rendering).
// Optional fields: enumValues only for type=enum; min/max for integer/number.
export type EmployeeField = {
  name: string;
  label: string;
  type: FieldDataType;
  tier: FieldTier;
  required: boolean;
  pii: boolean;
  selectableForPredicates: boolean;
  // Standard-only: tenant can flip these off without removing the field.
  enabled?: boolean;
  // Built-in only: indicates the value is computed (not user-entered).
  computed?: boolean;
  // Portal: employee can update this field via self-service profile edit.
  employeeEditable?: boolean;
  // Type-specific.
  enumValues?: string[];
  min?: number;
  max?: number;
};

// Custom-field input regex per v2 §8 S11 AC. Lower-case, dotted, snake-case.
export const CUSTOM_FIELD_NAME_PATTERN = /^employee\.[a-z][a-z0-9_]*$/;

// Inline type used by both server and client; the matching Zod
// validator is defined in apps/web/src/server/trpc/routers/employee-schema.ts.
export type CustomFieldInput = {
  name: string;
  label: string;
  type: FieldDataType;
  required: boolean;
  pii: boolean;
  selectableForPredicates: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
};

// ── Defaults — copied onto every new tenant's EmployeeSchema ────

export const BUILTIN_FIELDS: EmployeeField[] = [
  {
    name: 'employee.full_name',
    label: 'Full Name',
    type: 'string',
    tier: 'BUILTIN',
    required: true,
    pii: true,
    selectableForPredicates: false,
  },
  {
    name: 'employee.date_of_birth',
    label: 'Date of Birth',
    type: 'date',
    tier: 'BUILTIN',
    required: true,
    pii: true,
    selectableForPredicates: true,
  },
  {
    name: 'employee.age_next_birthday',
    label: 'Age Next Birthday',
    type: 'integer',
    tier: 'BUILTIN',
    required: false,
    pii: false,
    selectableForPredicates: true,
    computed: true,
    min: 0,
    max: 120,
  },
  {
    name: 'employee.hire_date',
    label: 'Hire Date',
    type: 'date',
    tier: 'BUILTIN',
    required: true,
    pii: false,
    selectableForPredicates: true,
  },
  {
    name: 'employee.employment_status',
    label: 'Employment Status',
    type: 'enum',
    tier: 'BUILTIN',
    required: true,
    pii: false,
    selectableForPredicates: true,
    enumValues: ['ACTIVE', 'SUSPENDED', 'TERMINATED'],
  },
];

export const STANDARD_FIELDS: EmployeeField[] = [
  {
    name: 'employee.nationality',
    label: 'Nationality',
    type: 'enum',
    tier: 'STANDARD',
    required: false,
    pii: true,
    selectableForPredicates: true,
    enabled: true,
    enumValues: ['SG', 'PR', 'MY', 'IN', 'PH', 'CN', 'FOREIGN'],
  },
  {
    name: 'employee.work_pass_type',
    label: 'Work Pass Type',
    type: 'enum',
    tier: 'STANDARD',
    required: false,
    pii: true,
    selectableForPredicates: true,
    enabled: true,
    enumValues: ['CITIZEN', 'PR', 'EP', 'S_PASS', 'WORK_PERMIT', 'DEPENDANT_PASS', 'NONE'],
  },
  {
    name: 'employee.employment_type',
    label: 'Employment Type',
    type: 'enum',
    tier: 'STANDARD',
    required: false,
    pii: false,
    selectableForPredicates: true,
    enabled: true,
    enumValues: ['PERMANENT', 'CONTRACT', 'INTERN', 'BARGAINABLE', 'NON_BARGAINABLE'],
  },
  {
    name: 'employee.last_drawn_salary',
    label: 'Last Drawn Monthly Salary',
    type: 'number',
    tier: 'STANDARD',
    required: false,
    pii: true,
    selectableForPredicates: true,
    enabled: true,
    min: 0,
    max: 999999,
  },
  {
    name: 'employee.role',
    label: 'Role Classification',
    type: 'enum',
    tier: 'STANDARD',
    required: false,
    pii: false,
    selectableForPredicates: true,
    enabled: false,
    enumValues: ['SENIOR_MGMT', 'CORPORATE_STAFF', 'JUNIOR'],
  },
  {
    name: 'employee.hay_job_grade',
    label: 'Hay Job Grade',
    type: 'integer',
    tier: 'STANDARD',
    required: false,
    pii: false,
    selectableForPredicates: true,
    enabled: false,
    min: 0,
    max: 30,
  },
  {
    name: 'employee.firefighter',
    label: 'Firefighter Role',
    type: 'boolean',
    tier: 'STANDARD',
    required: false,
    pii: false,
    selectableForPredicates: true,
    enabled: false,
  },
  {
    name: 'employee.manual_worker',
    label: 'Manual Worker',
    type: 'boolean',
    tier: 'STANDARD',
    required: false,
    pii: false,
    selectableForPredicates: true,
    enabled: false,
  },
  {
    name: 'employee.category',
    label: 'Category',
    type: 'string',
    tier: 'STANDARD',
    required: false,
    pii: false,
    selectableForPredicates: true,
    enabled: true,
  },
];

export const DEFAULT_EMPLOYEE_FIELDS: EmployeeField[] = [...BUILTIN_FIELDS, ...STANDARD_FIELDS];
