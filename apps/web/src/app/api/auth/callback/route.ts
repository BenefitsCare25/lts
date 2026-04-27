// =============================================================
// WorkOS OAuth callback route.
//
// AuthKit's handleAuth() exchanges the authorization code for a
// session and writes the encrypted session cookie. Mounted at the
// path advertised in WORKOS_REDIRECT_URI (default /api/auth/callback).
// =============================================================

import { isAuthConfigured } from '@/server/env';
import { handleAuth } from '@workos-inc/authkit-nextjs';
import { NextResponse } from 'next/server';

export const GET = isAuthConfigured()
  ? handleAuth({
      // Redirect to /admin after a successful sign-in. The middleware
      // gate on (admin) ensures we don't loop back through this route.
      returnPathname: '/admin',
    })
  : (): NextResponse =>
      NextResponse.json(
        {
          error: 'auth-not-configured',
          message: 'WorkOS env vars are not set. See .env.example.',
        },
        { status: 503 },
      );
