import { requireSession } from '@/server/auth/session';
import { BenefitGroupsScreen } from './_components/benefit-groups-screen';

export default async function BenefitGroupsPage({
  params,
}: {
  params: Promise<{ id: string; policyId: string }>;
}) {
  await requireSession();
  const { policyId } = await params;
  return <BenefitGroupsScreen policyId={policyId} />;
}
