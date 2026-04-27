// =============================================================
// Sign-out endpoint — clears the AuthKit session cookie and
// redirects back to /. Exposed as a GET so a plain <a> from the
// admin shell triggers it without needing a form submission.
// =============================================================

import { isAuthConfigured } from '@/server/env';
import { signOut } from '@workos-inc/authkit-nextjs';
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  if (!isAuthConfigured()) {
    return NextResponse.redirect(
      new URL('/', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    );
  }
  // signOut() throws a redirect Response — Next.js unwinds it.
  await signOut({ returnTo: '/' });
  // Unreachable, but typescript wants a return value.
  return NextResponse.redirect(
    new URL('/', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  );
}
