// =============================================================
// Server-side environment access.
//
// Phase 1 auth path: Auth.js with credentials. Two env vars matter:
//   AUTH_SECRET     — JWT signing secret (32+ random chars).
//   AUTH_TRUST_HOST — must be "true" when running behind a reverse
//                     proxy/ingress (Container Apps, Vercel preview,
//                     Cloudflare). Auth.js refuses unknown hosts
//                     otherwise.
//
// Production must boot only when AUTH_SECRET is present. Local dev
// boots without it and Auth.js will generate an ephemeral secret —
// fine for one-off testing, NEVER for shared dev DBs because the
// JWT cookies invalidate every restart.
// =============================================================

const PROD_REQUIRED = ['AUTH_SECRET'] as const;

type RequiredKey = (typeof PROD_REQUIRED)[number];

function read(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

export function isAuthConfigured(): boolean {
  return PROD_REQUIRED.every((key) => read(key) !== undefined);
}

export function assertAuthConfigured(): void {
  const missing = PROD_REQUIRED.filter((key) => read(key) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Auth not configured. Missing env vars: ${missing.join(', ')}. See .env.example for setup instructions.`,
    );
  }
}

export function getAuthEnv(): Record<RequiredKey, string> {
  assertAuthConfigured();
  return {
    AUTH_SECRET: read('AUTH_SECRET') as string,
  };
}

// Called once at module init to surface misconfiguration early.
// In production we throw immediately. In development we log a
// warning and let Auth.js fall back to its dev-only ephemeral secret.
export function validateEnvOnBoot(): void {
  const isProd = process.env.NODE_ENV === 'production';
  if (isAuthConfigured()) return;

  const missing = PROD_REQUIRED.filter((key) => read(key) === undefined);
  if (isProd) {
    throw new Error(`Production startup blocked. Missing env vars: ${missing.join(', ')}.`);
  }
  console.warn(
    `[env] AUTH_SECRET not set — Auth.js will generate an ephemeral signing secret for this process. Sessions will invalidate on restart. Missing: ${missing.join(', ')}.`,
  );
}
