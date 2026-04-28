// =============================================================
// /admin/clients/[id]/employees — Employee CRUD + CSV import (S33-S34).
// =============================================================

import { requireSession } from '@/server/auth/session';
import { EmployeesScreen } from './_components/employees-screen';

export default async function EmployeesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  return <EmployeesScreen clientId={id} />;
}
