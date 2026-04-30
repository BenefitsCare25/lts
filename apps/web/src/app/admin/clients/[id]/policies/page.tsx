import { requireSession } from '@/server/auth/session';
import { ClientPoliciesScreen } from './_components/policies-screen';

export default async function ClientPoliciesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  return <ClientPoliciesScreen clientId={id} />;
}
