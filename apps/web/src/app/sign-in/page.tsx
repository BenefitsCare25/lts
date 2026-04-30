// =============================================================
// Sign-in page — credentials form. Posts to a server action that
// calls Auth.js's signIn() and redirects on success.
//
// `callbackUrl` is restricted to relative same-origin paths to
// prevent open-redirect phishing. Auth.js v5 also filters this
// internally, but we belt-and-brace at the application boundary
// in case a future Auth.js change widens the policy.
// =============================================================

import { signIn } from '@/server/auth/config';
import { readClientIp, signInEmailLimiter, signInIpLimiter } from '@/server/security/rate-limit';
import { AuthError } from 'next-auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

type SearchParams = Promise<{ callbackUrl?: string; error?: string }>;

const DEFAULT_LANDING = '/admin';

// Accepts only same-origin relative paths beginning with a single
// "/". Rejects:
//   - protocol-relative URLs ("//evil.example") — single-char check
//     `!t.startsWith('//')` catches these
//   - absolute URLs ("https://evil.example/x") — `t.startsWith('/')`
//     fails for these
//   - empty string / non-string inputs — falls through to default
//   - back-slashes ("/\\evil.example") — Chrome treats `\` as `/` in
//     URL parsing so we strip them defensively
function safeCallbackUrl(value: FormDataEntryValue | string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return DEFAULT_LANDING;
  // Defensive normalisation against `\` being treated as `/` by some parsers.
  const normalised = value.replace(/\\/g, '/');
  if (!normalised.startsWith('/') || normalised.startsWith('//')) return DEFAULT_LANDING;
  return normalised;
}

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { callbackUrl, error } = await searchParams;
  const safeInitialCallback = safeCallbackUrl(callbackUrl);

  async function authenticate(formData: FormData): Promise<void> {
    'use server';
    const email = formData.get('email');
    const password = formData.get('password');
    const redirectTo = safeCallbackUrl(formData.get('callbackUrl'));

    // Rate-limit by IP and by email separately so an attacker is
    // throttled whether they vary the email (probing accounts from
    // one IP) or vary the source IP (distributed attack against one
    // account). Limits live in-process per replica — sufficient as a
    // speed bump for Phase 1; Phase 2 swaps in a Redis backend when
    // multi-replica scale matters.
    const ip = readClientIp(await headers());
    const ipResult = signInIpLimiter.check(`signin:${ip}`);
    if (!ipResult.allowed) {
      redirect('/sign-in?error=RATE_LIMITED');
    }
    if (typeof email === 'string' && email.length > 0) {
      const emailResult = signInEmailLimiter.check(`signin:${email.toLowerCase()}`);
      if (!emailResult.allowed) {
        redirect('/sign-in?error=RATE_LIMITED');
      }
    }

    try {
      await signIn('credentials', {
        email,
        password,
        redirectTo,
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
              : error === 'RATE_LIMITED'
                ? 'Too many sign-in attempts. Please wait a few minutes and try again.'
                : `Sign-in failed: ${error}`}
          </p>
        ) : null}

        <form action={authenticate} className="form-grid stack-4" style={{ maxWidth: 'unset' }}>
          <input type="hidden" name="callbackUrl" value={safeInitialCallback} />
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
