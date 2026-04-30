import { requireSession } from '@/server/auth/session';
import { InsurerCreateForm } from '../_components/insurer-create-form';

export default async function NewInsurerPage() {
  await requireSession();
  return <InsurerCreateForm />;
}
