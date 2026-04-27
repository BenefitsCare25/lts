// =============================================================
// Session helpers — wraps AuthKit's withAuth for ergonomics.
//
// getSession() returns the user info or null (never throws).
// requireSession() returns the user info or redirects to /sign-in.
//
// Phase 1 status: tenant id is NOT yet attached. Story S3 wires
// the tenantId resolution and exposes a tenant-scoped Prisma
// client; until then call sites should not assume tenant scoping.
// =============================================================

import { isAuthConfigured } from '@/server/env';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

export type SessionUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  // Roles attached at the WorkOS organization level, populated by
  // AuthKit from the access-token claims. Empty array if absent.
  roles: string[];
};

export type Session = {
  user: SessionUser;
  // WorkOS access token — used downstream when we need to call the
  // WorkOS API on behalf of the user (organization listing, etc).
  accessToken: string;
};

export async function getSession(): Promise<Session | null> {
  if (!isAuthConfigured()) return null;

  const auth = await withAuth();
  if (!auth.user) return null;

  return {
    user: {
      id: auth.user.id,
      email: auth.user.email,
      firstName: auth.user.firstName ?? null,
      lastName: auth.user.lastName ?? null,
      roles: auth.roles ?? (auth.role ? [auth.role] : []),
    },
    accessToken: auth.accessToken,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect('/sign-in');
  }
  return session;
}
