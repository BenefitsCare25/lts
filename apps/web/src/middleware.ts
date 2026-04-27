// =============================================================
// Next.js middleware — gates (admin) routes via WorkOS AuthKit.
//
// When WorkOS env vars are absent (e.g. local dev pre-provisioning),
// the middleware short-circuits and lets every request through.
// /admin routes then render an "auth not configured" notice instead
// of redirecting into a non-functional WorkOS flow.
// =============================================================

import { isAuthConfigured } from '@/server/env';
import { authkitMiddleware } from '@workos-inc/authkit-nextjs';
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';

const middlewareInstance = isAuthConfigured()
  ? authkitMiddleware({
      middlewareAuth: {
        enabled: true,
        // Paths that don't require an authenticated session.
        // Everything else routed via this matcher requires auth.
        unauthenticatedPaths: ['/', '/sign-in', '/sign-up', '/api/trpc/(.*)'],
      },
    })
  : null;

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (!middlewareInstance) {
    return NextResponse.next();
  }
  return middlewareInstance(request, event);
}

export const config = {
  // Apply to everything except static assets, the Next.js internals,
  // and Playwright's reload helpers. The handler itself decides which
  // of those paths actually require a session.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|gif|ico)).*)'],
};
