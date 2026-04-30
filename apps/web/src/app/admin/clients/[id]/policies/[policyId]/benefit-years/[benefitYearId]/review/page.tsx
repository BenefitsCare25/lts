import { requireSession } from '@/server/auth/session';
import { ReviewScreen } from './_components/review-screen';

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string; policyId: string; benefitYearId: string }>;
}) {
  await requireSession();
  const { id, policyId, benefitYearId } = await params;
  return <ReviewScreen clientId={id} policyId={policyId} benefitYearId={benefitYearId} />;
}
