// =============================================================
// Sign-in entry point — generates a WorkOS authorization URL and
// redirects there. AuthKit handles the rest of the OAuth flow and
// returns to /api/auth/callback.
// =============================================================

import { isAuthConfigured } from '@/server/env';
import { getSignInUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

export default async function SignInPage() {
  if (!isAuthConfigured()) {
    return (
      <main>
        <h1>Sign-in unavailable</h1>
        <p>
          WorkOS authentication is not configured for this environment. Set the WorkOS env vars in{' '}
          <code>.env</code> (see <code>.env.example</code>) and restart the dev server.
        </p>
      </main>
    );
  }

  const url = await getSignInUrl();
  redirect(url);
}
