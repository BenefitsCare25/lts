// =============================================================
// /admin/.../plans/[planId]/edit — edit plan page (S22).
// =============================================================

import { requireSession } from '@/server/auth/session';
import { PlanForm } from '../../_components/plan-form';

export default async function EditPlanPage({
  params,
}: {
  params: Promise<{
    id: string;
    policyId: string;
    benefitYearId: string;
    productId: string;
    planId: string;
  }>;
}) {
  await requireSession();
  const { id, policyId, benefitYearId, productId, planId } = await params;
  return (
    <PlanForm
      clientId={id}
      policyId={policyId}
      benefitYearId={benefitYearId}
      productId={productId}
      planId={planId}
      mode="edit"
    />
  );
}
