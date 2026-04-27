// =============================================================
// /admin layout — every nested route requires a signed-in user.
// The Auth.js middleware (apps/web/src/middleware.ts) bounces
// unauthenticated requests to /sign-in before they reach this
// layout; requireSession() is a redundant defence-in-depth check.
// =============================================================

import { requireSession } from '@/server/auth/session';
import type { ReactNode } from 'react';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  return (
    <div data-admin-shell>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <strong>
            <a href="/admin" style={{ color: 'inherit', textDecoration: 'none' }}>
              Insurance SaaS · admin
            </a>
          </strong>
          <nav style={{ display: 'flex', gap: '1rem' }}>
            <a href="/admin/catalogue/insurers">Insurers</a>
          </nav>
        </div>
        <nav>
          <span style={{ marginRight: '0.75rem' }}>{session.user.email}</span>
          <a href="/sign-out">Sign out</a>
        </nav>
      </header>
      <main style={{ padding: '1rem' }}>{children}</main>
    </div>
  );
}
