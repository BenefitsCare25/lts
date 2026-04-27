import { requireSession } from '@/server/auth/session';
import { ProductTypeForm } from '../_components/product-type-form';

export default async function NewProductTypePage() {
  await requireSession();
  return <ProductTypeForm />;
}
