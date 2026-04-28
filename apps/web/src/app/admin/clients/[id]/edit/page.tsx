// =============================================================
// /admin/clients/[id]/edit — edit form for one client.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { EditClientForm } from './_form';

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  return <EditClientForm clientId={id} />;
}
