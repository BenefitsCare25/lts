// =============================================================
// /admin/clients/[id]/policies/[policyId]/benefit-years/
//   [benefitYearId]/products — Screen 3, S15.
//
// Repeating-row product picker for one BenefitYear. The Insurer
// dropdown filters by the chosen ProductType's productsSupported.
// =============================================================

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
