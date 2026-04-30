import { requireSession } from '@/server/auth/session';
import { ImportsScreen } from './_components/imports-screen';

export default async function ImportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  return <ImportsScreen clientId={id} />;
}
