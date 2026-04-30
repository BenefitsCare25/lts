import { requireSession } from '@/server/auth/session';
import { PlanForm } from '../_components/plan-form';

export default async function NewPlanPage({
  params,
}: {
  params: Promise<{
    id: string;
    policyId: string;
    benefitYearId: string;
    productId: string;
  }>;
}) {
  await requireSession();
  const { id, policyId, benefitYearId, productId } = await params;
  return (
    <PlanForm
      clientId={id}
      policyId={policyId}
      benefitYearId={benefitYearId}
      productId={productId}
      mode="create"
    />
  );
}
