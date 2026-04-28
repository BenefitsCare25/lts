// =============================================================
// /admin/clients/[id]/policies/[policyId]/edit — edit one policy
// (name + entities + rateOverrides). Server shell only.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { EditPolicyForm } from './_form';

export default async function EditPolicyPage({
  params,
}: {
  params: Promise<{ id: string; policyId: string }>;
}) {
  await requireSession();
  const { id, policyId } = await params;
  return <EditPolicyForm clientId={id} policyId={policyId} />;
}
