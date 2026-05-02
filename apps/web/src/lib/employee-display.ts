export function employeeDisplayLabel(data: Record<string, unknown>): string {
  const fullName = data['employee.full_name'];
  if (typeof fullName === 'string' && fullName) return fullName;
  for (const v of Object.values(data)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '(no name)';
}
