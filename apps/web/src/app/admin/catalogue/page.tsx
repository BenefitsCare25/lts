import { redirect } from 'next/navigation';

export default function CatalogueIndex() {
  redirect('/admin/catalogue/product-types');
}
