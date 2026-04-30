import { requireSession } from '@/server/auth/session';
import { ProductsScreen } from './_components/products-screen';

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ id: string; policyId: string; benefitYearId: string }>;
}) {
  await requireSession();
  const { id, policyId, benefitYearId } = await params;
  return <ProductsScreen clientId={id} policyId={policyId} benefitYearId={benefitYearId} />;
}
