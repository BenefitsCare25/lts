import { requireSession } from '@/server/auth/session';
import { PoolCreateForm } from '../_components/pool-create-form';

export default async function NewPoolPage() {
  await requireSession();
  return <PoolCreateForm />;
}
