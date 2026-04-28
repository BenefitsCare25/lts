// =============================================================
// /admin/clients — list + inline create form (Screen 1, S13).
//
// Server component shell so the route is auth-gated by the
// (admin) layout. ClientsScreen does the data fetch + form.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { ClientsScreen } from './_components/clients-screen';

export default async function ClientsPage() {
  await requireSession();
  return <ClientsScreen />;
}
