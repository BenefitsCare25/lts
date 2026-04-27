// =============================================================
// (admin) layout — every nested route requires a WorkOS session.
//
// When auth isn't configured (env vars missing), we render a
// configuration-help screen instead of redirecting into a broken
// WorkOS flow. The middleware leaves /admin untouched in that
// case, so this layout is the gate.
// =============================================================

import { requireSession } from '@/server/auth/session';
import { isAuthConfigured } from '@/server/env';
import type { ReactNode } from 'react';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!isAuthConfigured()) {
    return <AuthDisabledNotice />;
  }

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

function AuthDisabledNotice() {
  return (
    <main style={{ padding: '2rem', maxWidth: '40rem' }}>
      <h1>Admin disabled</h1>
      <p>
        WorkOS authentication is not configured for this environment, so the broker admin surfaces
        are unreachable. To enable them:
      </p>
      <ol>
        <li>
          Create a WorkOS project and copy the API key + Client ID from the dashboard
          (https://dashboard.workos.com).
        </li>
        <li>
          Generate a 32+ character cookie password (<code>openssl rand -base64 32</code>).
        </li>
        <li>
          Fill <code>WORKOS_API_KEY</code>, <code>WORKOS_CLIENT_ID</code>,{' '}
          <code>WORKOS_COOKIE_PASSWORD</code>, and <code>WORKOS_REDIRECT_URI</code> in your{' '}
          <code>.env</code> file.
        </li>
        <li>Restart the dev server.</li>
      </ol>
      <p>
        See <code>.env.example</code> in the repo root for the canonical comment block.
      </p>
    </main>
  );
}
