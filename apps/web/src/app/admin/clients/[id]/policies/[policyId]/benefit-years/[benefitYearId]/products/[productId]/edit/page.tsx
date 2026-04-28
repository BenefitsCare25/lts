// =============================================================
// /admin/clients/[id]/policies/[policyId]/benefit-years/
//   [benefitYearId]/products/[productId]/edit — Screen 5 host.
//
// Hosts the four per-product sub-tabs (Details, Plans, Eligibility,
// Premium). S21 ships Details; the other three are placeholder
// stubs until S22-S24 land.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { ProductEditScreen } from './_components/product-edit-screen';

export default async function ProductEditPage({
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
    <ProductEditScreen
      clientId={id}
      policyId={policyId}
      benefitYearId={benefitYearId}
      productId={productId}
    />
  );
}
