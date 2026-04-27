// =============================================================
// /admin layout — sticky glass header + main content area.
// The Auth.js middleware bounces unauthenticated requests to
// /sign-in before they reach this layout; requireSession() is a
// redundant defence-in-depth check.
// =============================================================

import { requireSession } from '@/server/auth/session';
import type { ReactNode } from 'react';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="app-header__brand">
            <a href="/admin">Insurance SaaS</a>
          </span>
          <nav className="app-header__nav" aria-label="Catalogue admin">
            <a className="nav-link" href="/admin/catalogue/insurers">
              Insurers
            </a>
            <a className="nav-link" href="/admin/catalogue/tpas">
              TPAs
            </a>
            <a className="nav-link" href="/admin/catalogue/pools">
              Pools
            </a>
          </nav>
        </div>
        <div className="app-header__user">
          <span>{session.user.email}</span>
          <a className="btn btn-ghost btn-sm" href="/sign-out">
            Sign out
          </a>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
