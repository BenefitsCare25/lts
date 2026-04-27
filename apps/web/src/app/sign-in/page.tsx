// =============================================================
// Sign-in page — credentials form. Posts to a server action that
// calls Auth.js's signIn() and redirects on success.
// =============================================================

import { signIn } from '@/server/auth/config';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';

type SearchParams = Promise<{ callbackUrl?: string; error?: string }>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { callbackUrl, error } = await searchParams;

  async function authenticate(formData: FormData): Promise<void> {
    'use server';
    const email = formData.get('email');
    const password = formData.get('password');
    const target = formData.get('callbackUrl');
    try {
      await signIn('credentials', {
        email,
        password,
        redirectTo: typeof target === 'string' && target.length > 0 ? target : '/admin',
      });
    } catch (err) {
      if (err instanceof AuthError) {
        // Surface a friendly message via the URL — server actions can't
        // return a value while also redirecting, and Auth.js's redirect
        // is fired by re-throwing. We catch only auth failures and bounce.
        redirect(`/sign-in?error=${err.type}`);
      }
      throw err;
    }
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '24rem' }}>
      <h1>Sign in</h1>
      <p>Local credentials. Ask the platform admin if you don&apos;t have an account.</p>

      {error ? (
        <p style={{ color: '#b91c1c' }}>
          {error === 'CredentialsSignin'
            ? 'Email or password is incorrect.'
            : `Sign-in failed: ${error}`}
        </p>
      ) : null}

      <form action={authenticate} style={{ display: 'grid', gap: '0.75rem' }}>
        <input type="hidden" name="callbackUrl" value={callbackUrl ?? '/admin'} />
        <label>
          <div>Email</div>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            style={{ width: '100%' }}
          />
        </label>
        <label>
          <div>Password</div>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            style={{ width: '100%' }}
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
