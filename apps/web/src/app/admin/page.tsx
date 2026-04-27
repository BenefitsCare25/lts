// =============================================================
// /admin landing — authenticated dashboard placeholder.
//
// Real content lands as the catalogue / clients / policies surfaces
// arrive in later stories.
// =============================================================

import { requireSession } from '@/server/auth/session';

export default async function AdminHomePage() {
  const session = await requireSession();

  return (
    <section>
      <h1>Welcome, {session.user.email}</h1>
      <dl>
        <dt>User id</dt>
        <dd>
          <code>{session.user.id}</code>
        </dd>
        <dt>Tenant id</dt>
        <dd>
          <code>{session.user.tenantId}</code>
        </dd>
        <dt>Role</dt>
        <dd>
          <code>{session.user.role}</code>
        </dd>
      </dl>
    </section>
  );
}
