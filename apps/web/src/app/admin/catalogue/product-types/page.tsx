// =============================================================
// /admin/catalogue/product-types — Product Catalogue editor (S12).
// =============================================================

import { requireSession } from '@/server/auth/session';
import { ProductTypesScreen } from './_components/product-types-screen';

export default async function ProductTypesPage() {
  await requireSession();
  return <ProductTypesScreen />;
}
