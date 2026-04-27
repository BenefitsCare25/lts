// =============================================================
// Sign-out endpoint — clears the Auth.js session cookie and
// redirects back to /. Exposed as a GET so a plain <a> from the
// admin shell triggers it without needing a form submission.
// =============================================================

import { signOut } from '@/server/auth/config';

export async function GET(): Promise<Response> {
  await signOut({ redirectTo: '/' });
  // signOut throws a redirect; this return is unreachable.
  return new Response(null, { status: 302, headers: { Location: '/' } });
}
