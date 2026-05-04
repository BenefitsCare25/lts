import type { EmployeeField } from '@insurance-saas/shared-types';

// Convert a single EmployeeField's type definition to a JSON Schema property.
// Callers are responsible for deciding which fields to include and whether
// to emit a `required` array.
export function fieldToPropSchema(f: EmployeeField): Record<string, unknown> {
  const prop: Record<string, unknown> = {};
  switch (f.type) {
    case 'string':
      prop.type = 'string';
      break;
    case 'integer':
      prop.type = 'integer';
      if (f.min !== undefined) prop.minimum = f.min;
      if (f.max !== undefined) prop.maximum = f.max;
      break;
    case 'number':
      prop.type = 'number';
      if (f.min !== undefined) prop.minimum = f.min;
      if (f.max !== undefined) prop.maximum = f.max;
      break;
    case 'boolean':
      prop.type = 'boolean';
      break;
    case 'date':
      prop.type = 'string';
      prop.format = 'date';
      break;
    case 'enum':
      prop.type = 'string';
      if (f.enumValues && f.enumValues.length > 0) prop.enum = f.enumValues;
      break;
  }
  return prop;
}
