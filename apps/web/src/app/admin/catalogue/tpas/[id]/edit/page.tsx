// =============================================================
// /admin/catalogue/tpas/[id]/edit — edit form for one TPA.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { EditTpaForm } from './_form';

export default async function EditTpaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  return <EditTpaForm tpaId={id} />;
}
