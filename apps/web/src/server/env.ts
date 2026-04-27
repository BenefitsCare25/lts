// =============================================================
// Server-side environment access.
//
// One source of truth for which env vars matter and how the app
// should behave when they're missing. Phase 1 supports a "WorkOS
// not configured" mode so that local dev works before the WorkOS
// project has been provisioned — but in production the app must
// fail fast if any required key is absent.
// =============================================================

const PROD_REQUIRED = [
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'WORKOS_REDIRECT_URI',
] as const;

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
      `WorkOS auth is not configured. Missing env vars: ${missing.join(', ')}. See .env.example for setup instructions.`,
    );
  }
}

export function getAuthEnv(): Record<RequiredKey, string> {
  assertAuthConfigured();
  return {
    WORKOS_API_KEY: read('WORKOS_API_KEY') as string,
    WORKOS_CLIENT_ID: read('WORKOS_CLIENT_ID') as string,
    WORKOS_COOKIE_PASSWORD: read('WORKOS_COOKIE_PASSWORD') as string,
    WORKOS_REDIRECT_URI: read('WORKOS_REDIRECT_URI') as string,
  };
}

// Called once at module init to surface misconfiguration early.
// In production we throw immediately. In development we log a
// warning so the dev server keeps running with /admin disabled.
export function validateEnvOnBoot(): void {
  const isProd = process.env.NODE_ENV === 'production';
  if (isAuthConfigured()) return;

  const missing = PROD_REQUIRED.filter((key) => read(key) === undefined);
  if (isProd) {
    throw new Error(`Production startup blocked. Missing env vars: ${missing.join(', ')}.`);
  }
  console.warn(
    `[env] WorkOS auth not configured — running with /admin disabled. Missing: ${missing.join(', ')}.`,
  );
}
