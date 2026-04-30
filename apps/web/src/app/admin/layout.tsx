import { SectionRail } from '@/components/admin/section-rail';
import { TopNav } from '@/components/admin/top-nav';
import { requireSession } from '@/server/auth/session';
import type { ReactNode } from 'react';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Defence-in-depth — middleware already bounces unauthenticated requests to /sign-in.
  const session = await requireSession();

  return (
    <div className="admin-shell">
      <header className="app-header">
        <div className="flex items-center">
          <span className="app-header__brand">
            <a href="/admin">Insurance SaaS</a>
          </span>
          <TopNav />
        </div>
        <div className="app-header__user">
          <span>{session.user.email}</span>
          <a className="btn btn-ghost btn-sm" href="/sign-out">
            Sign out
          </a>
        </div>
      </header>
      <div className="admin-body">
        <aside className="admin-aside">
          <SectionRail />
        </aside>
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
