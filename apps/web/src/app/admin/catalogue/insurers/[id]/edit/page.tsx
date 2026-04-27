// =============================================================
// /admin/catalogue/insurers/[id]/edit — edit form for one insurer.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { EditInsurerForm } from './_form';

export default async function EditInsurerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  return <EditInsurerForm insurerId={id} />;
}
