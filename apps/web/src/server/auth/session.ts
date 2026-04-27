// =============================================================
// Session helpers — wraps Auth.js's auth() for ergonomics.
//
// getSession() returns the user info or null (never throws).
// requireSession() returns the user info or redirects to /sign-in.
//
// Session.user.id is our internal User.id (cuid). Pre-populated
// onto the JWT during sign-in so callers don't need a DB round-trip.
// =============================================================

import { redirect } from 'next/navigation';
import { auth } from './config';

export type SessionUser = {
  id: string;
  email: string;
  tenantId: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  // Reserved for future role expansion. Kept here so the type didn't
  // change shape across the WorkOS swap; consumers that read roles[]
  // continue to compile.
  roles: string[];
};

export type Session = {
  user: SessionUser;
};

export async function getSession(): Promise<Session | null> {
  const result = await auth();
  if (!result?.user?.id) return null;

  const fullName = result.user.name ?? '';
  const [firstName = null, ...rest] = fullName.length > 0 ? fullName.split(' ') : [];

  return {
    user: {
      id: result.user.id,
      email: result.user.email ?? '',
      tenantId: result.user.tenantId,
      role: result.user.role,
      firstName,
      lastName: rest.length > 0 ? rest.join(' ') : null,
      roles: result.user.role ? [result.user.role] : [],
    },
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect('/sign-in');
  }
  return session;
}
