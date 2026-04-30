// =============================================================
// /admin/clients/new — two-mode entry into client creation.
//
// The page is server-side wrapped via requireSession; the actual
// surface is the client component CreateModeScreen, which presents:
//   1. Import slip — drop a placement slip; AI populates a wizard
//   2. Type details — bypass the wizard and use the manual form
//
// Both modes ultimately produce a Client + Policy + BenefitYear
// structure. The wizard does it from extracted slip data; manual
// entry produces just the Client and lets the broker set up the
// rest under /admin/clients/[id].
// =============================================================

import { requireSession } from '@/server/auth/session';
import { CreateModeScreen } from './_components/create-mode-screen';

export default async function NewClientPage() {
  await requireSession();
  return <CreateModeScreen />;
}
