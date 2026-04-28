// =============================================================
// /admin/clients/[id]/policies/[policyId]/benefit-groups
// Screen 4 (S18) — Benefit groups list + predicate builder.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { BenefitGroupsScreen } from './_components/benefit-groups-screen';

export default async function BenefitGroupsPage({
  params,
}: {
  params: Promise<{ id: string; policyId: string }>;
}) {
  await requireSession();
  const { id, policyId } = await params;
  return <BenefitGroupsScreen clientId={id} policyId={policyId} />;
}
