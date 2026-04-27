// =============================================================
// /admin/catalogue/insurers — list + inline create form.
//
// Server component shell so the route is auth-gated by the
// (admin) layout. Heavy lifting (list, create, delete) is in
// the client component below.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { InsurersScreen } from './_components/insurers-screen';

export default async function InsurersPage() {
  await requireSession();
  return <InsurersScreen />;
}
