import { requireSession } from '@/server/auth/session';
import { TpaCreateForm } from '../_components/tpa-create-form';

export default async function NewTpaPage() {
  await requireSession();
  return <TpaCreateForm />;
}
