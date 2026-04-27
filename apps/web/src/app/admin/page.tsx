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
    <section className="section">
      <p className="eyebrow">Welcome back</p>
      <h1 style={{ marginBottom: '1.5rem' }}>{session.user.email}</h1>
      <div className="card card-padded">
        <h3>Session</h3>
        <dl className="dl">
          <dt>User id</dt>
          <dd>{session.user.id}</dd>
          <dt>Tenant id</dt>
          <dd>{session.user.tenantId}</dd>
          <dt>Role</dt>
          <dd>{session.user.role}</dd>
        </dl>
      </div>
    </section>
  );
}
