// Loads the product type and hands it to the shared form once
// the data arrives. The form is intentionally not a hook target
// directly; mounting it with stale `initial` props would burn
// the JsonTextarea's local state on subsequent re-renders.

'use client';

import { trpc } from '@/lib/trpc/client';
import { ProductTypeForm } from '../../_components/product-type-form';

export function EditProductTypeWrapper({ productTypeId }: { productTypeId: string }) {
  const query = trpc.productTypes.byId.useQuery({ id: productTypeId });

  if (query.isLoading) return <p>Loading…</p>;
  if (query.error) return <p className="field-error">Failed to load: {query.error.message}</p>;
  if (!query.data) return null;

  return <ProductTypeForm initial={query.data} />;
}
