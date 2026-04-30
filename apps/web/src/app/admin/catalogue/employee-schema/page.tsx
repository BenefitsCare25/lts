import { requireSession } from '@/server/auth/session';
import { EmployeeSchemaScreen } from './_components/employee-schema-screen';

export default async function EmployeeSchemaPage() {
  await requireSession();
  return <EmployeeSchemaScreen />;
}
