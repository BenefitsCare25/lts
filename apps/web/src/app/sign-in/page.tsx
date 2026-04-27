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
        // Server actions can't return + redirect at the same time, so we
        // bounce errors via the URL and re-render the form.
        redirect(`/sign-in?error=${err.type}`);
      }
      throw err;
    }
  }

  return (
    <div className="signin-shell">
      <div className="signin-card glass-strong">
        <p className="eyebrow">Insurance SaaS</p>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: '0.25rem' }}>Sign in</h1>
        <p>Local credentials. Ask the platform admin if you don&apos;t have an account.</p>

        {error ? (
          <p className="field-error" role="alert">
            {error === 'CredentialsSignin'
              ? 'Email or password is incorrect.'
              : `Sign-in failed: ${error}`}
          </p>
        ) : null}

        <form action={authenticate} className="form-grid stack-4" style={{ maxWidth: 'unset' }}>
          <input type="hidden" name="callbackUrl" value={callbackUrl ?? '/admin'} />
          <div className="field">
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoComplete="email"
              className="input"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="input"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
