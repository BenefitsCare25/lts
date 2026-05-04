import { requireSession } from '@/server/auth/session';
import { DashboardScreen } from '@/components/portal/dashboard-screen';

export default async function PortalDashboard() {
  const session = await requireSession();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">
        Welcome{session.user.firstName ? `, ${session.user.firstName}` : ''}
      </h1>
      <DashboardScreen />
    </div>
  );
}
