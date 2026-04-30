import { requireSession } from '@/server/auth/session';
import { PolicyCreateForm } from '../_components/policy-create-form';

export default async function NewPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  return <PolicyCreateForm clientId={id} />;
}
