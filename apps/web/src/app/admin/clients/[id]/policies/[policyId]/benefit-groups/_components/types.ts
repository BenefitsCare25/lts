export type EmployeeField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  pii: boolean;
  selectableForPredicates: boolean;
  enabled?: boolean;
  enumValues?: string[];
  min?: number;
  max?: number;
  tier: string;
};

export type OperatorRow = {
  code: string;
  label: string;
  arity: 'single' | 'multi' | 'range';
};

export type FormRow = {
  field: string;
  operator: string;
  // String-encoded value(s); typed and parsed at submit time.
  value: string;
  // For "between" range; otherwise unused.
  valueHi: string;
  // For "in"/"notIn" multiselect; otherwise unused.
  valueMulti: string[];
};

export const emptyRow = (): FormRow => ({
  field: '',
  operator: '',
  value: '',
  valueHi: '',
  valueMulti: [],
});
