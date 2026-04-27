// =============================================================
// /admin/catalogue/tpas — list + inline create form (S9, Screen 0c).
// =============================================================

import { requireSession } from '@/server/auth/session';
import { TpasScreen } from './_components/tpas-screen';

export default async function TpasPage() {
  await requireSession();
  return <TpasScreen />;
}
