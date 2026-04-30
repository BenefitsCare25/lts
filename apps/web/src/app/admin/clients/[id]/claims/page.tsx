import { requireSession } from '@/server/auth/session';
import { ClaimsScreen } from './_components/claims-screen';

export default async function ClaimsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  return <ClaimsScreen clientId={id} />;
}
