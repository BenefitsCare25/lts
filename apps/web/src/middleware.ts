// =============================================================
// Next.js middleware — gates /admin via Auth.js.
//
// Auth.js middleware just checks for a valid session cookie; the
// real authorization happens in the (admin) layout where we resolve
// the full session and tenant context.
// =============================================================

import { auth } from '@/server/auth/config';

export default auth((req) => {
  const isAdminPath = req.nextUrl.pathname.startsWith('/admin');
  if (!isAdminPath) return;

  if (!req.auth) {
    const signInUrl = new URL('/sign-in', req.nextUrl.origin);
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return Response.redirect(signInUrl);
  }
});

export const config = {
  // Apply to everything except static assets, the Next.js internals,
  // and Playwright's reload helpers. The handler decides which paths
  // actually require a session.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|gif|ico)).*)'],
};
