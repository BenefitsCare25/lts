// =============================================================
// /admin/catalogue/pools/[id]/edit — edit form for one pool.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { EditPoolForm } from './_form';

export default async function EditPoolPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  return <EditPoolForm poolId={id} />;
}
