import { requireSession } from '@/server/auth/session';
import { PoolsScreen } from './_components/pools-screen';

export default async function PoolsPage() {
  await requireSession();
  return <PoolsScreen />;
}
