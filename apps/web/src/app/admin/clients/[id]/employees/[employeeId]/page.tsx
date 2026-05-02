import { requireSession } from '@/server/auth/session';
import { EmployeeDetailScreen } from './_components/employee-detail-screen';

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string; employeeId: string }>;
}) {
  await requireSession();
  const { id, employeeId } = await params;
  return <EmployeeDetailScreen clientId={id} employeeId={employeeId} />;
}
