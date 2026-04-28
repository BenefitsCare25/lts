// =============================================================
// /admin/clients/[id]/policies — list of policies under one
// client + inline create form (Screen 2 entry point, S14).
// =============================================================

import { requireSession } from '@/server/auth/session';
import { ClientPoliciesScreen } from './_components/policies-screen';

export default async function ClientPoliciesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  return <ClientPoliciesScreen clientId={id} />;
}
