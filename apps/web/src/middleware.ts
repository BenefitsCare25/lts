// =============================================================
// Next.js middleware — gates /admin and /portal via Auth.js.
//
// Auth.js middleware checks for a valid session cookie. Role-based
// routing sends employees to /portal and admins to /admin.
// =============================================================

import { auth } from '@/server/auth/config';

const PORTAL_ROLES = new Set(['CLIENT_HR', 'EMPLOYEE']);
const ADMIN_ROLES = new Set(['TENANT_ADMIN', 'BROKER_ADMIN', 'CATALOGUE_ADMIN']);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminPath = pathname.startsWith('/admin');
  const isPortalPath = pathname.startsWith('/portal');

  if (!isAdminPath && !isPortalPath) return;

  if (!req.auth) {
    const signInUrl = new URL('/sign-in', req.nextUrl.origin);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return Response.redirect(signInUrl);
  }

  const role = req.auth.user?.role;

  if (isAdminPath && role && PORTAL_ROLES.has(role)) {
    return Response.redirect(new URL('/portal', req.nextUrl.origin));
  }
  if (isPortalPath && role && ADMIN_ROLES.has(role)) {
    return Response.redirect(new URL('/admin', req.nextUrl.origin));
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|gif|ico)).*)'],
};
