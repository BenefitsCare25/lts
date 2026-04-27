// =============================================================
// /admin landing — authenticated dashboard placeholder.
//
// Real content lands as the catalogue / clients / policies surfaces
// arrive in later stories. For S2 this just confirms the WorkOS
// session round-trip works end-to-end.
// =============================================================

import { requireSession } from '@/server/auth/session';

export default async function AdminHomePage() {
  const session = await requireSession();
  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(' ') || session.user.email;

  return (
    <section>
      <h1>Welcome, {displayName}</h1>
      <p>You are signed in via WorkOS.</p>
      <dl>
        <dt>User id</dt>
        <dd>
          <code>{session.user.id}</code>
        </dd>
        <dt>Email</dt>
        <dd>
          <code>{session.user.email}</code>
        </dd>
        <dt>Roles</dt>
        <dd>
          <code>{session.user.roles.length > 0 ? session.user.roles.join(', ') : '(none)'}</code>
        </dd>
      </dl>
      <p>
        Tenant scoping arrives in Story S3. Until then this view shows the WorkOS user only —
        without resolving which Tenant they belong to.
      </p>
    </section>
  );
}
