import { requireSession } from '@/server/auth/session';
import { EditProductTypeWrapper } from './_wrapper';

export default async function EditProductTypePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  return <EditProductTypeWrapper productTypeId={id} />;
}
