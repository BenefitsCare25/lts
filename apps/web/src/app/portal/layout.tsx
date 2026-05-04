import { PortalNav } from '@/components/portal/portal-nav';
import { requireSession } from '@/server/auth/session';
import type { ReactNode } from 'react';

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <div className="portal-shell">
      <header className="app-header">
        <div className="flex items-center gap-6">
          <span className="app-header__brand">
            <a href="/portal">My Benefits</a>
          </span>
          <PortalNav />
        </div>
        <div className="app-header__user">
          <span>{session.user.email}</span>
          <a className="btn btn-ghost btn-sm" href="/sign-out">
            Sign out
          </a>
        </div>
      </header>
      <main className="portal-main">{children}</main>
    </div>
  );
}
