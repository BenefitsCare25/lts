import { requireSession } from '@/server/auth/session';
import { RulesScreen } from './_components/rules-screen';

export default async function RulesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  return <RulesScreen clientId={id} />;
}
