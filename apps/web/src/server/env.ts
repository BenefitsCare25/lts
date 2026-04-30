// =============================================================
// Server-side environment access.
//
// Two production-required secrets matter for boot:
//   AUTH_SECRET      — Auth.js JWT signing secret (32+ random chars).
//   APP_SECRET_KEY   — master key feeding `secret-cipher.ts` (AES-256-GCM
//                      for tenant BYOK creds). Min 32 chars. Rotating
//                      it without re-encrypting `TenantAiProvider.encryptedKey`
//                      makes every existing row undecryptable, so treat
//                      it as a one-time-set value.
//   AUTH_TRUST_HOST  — must be "true" when running behind a reverse
//                      proxy/ingress (Container Apps, Vercel preview,
//                      Cloudflare). Auth.js refuses unknown hosts
//                      otherwise. Not required at boot — Auth.js reads
//                      it directly.
//
// Production must boot only when AUTH_SECRET and APP_SECRET_KEY are
// both present and APP_SECRET_KEY is at least 32 characters. Local
// dev boots with warnings — Auth.js generates an ephemeral secret
// and `secret-cipher.ts` falls back to a deterministic dev key.
// =============================================================

const PROD_REQUIRED = ['AUTH_SECRET'] as const;
// Minimum APP_SECRET_KEY length. 32 chars ≈ 192 bits of entropy if
// the key was generated with `openssl rand -base64 48` and base64-
// encoded. The cipher itself is AES-256-GCM via scrypt KDF.
const APP_SECRET_KEY_MIN_LENGTH = 32;

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
// In production we throw immediately. In development we log a warning
// for each missing item and let the relevant subsystem fall back.
//
// Wired from `instrumentation.ts` so this fires at server start in all
// runtimes (Next.js, BullMQ workers, Container App boot).
export function validateEnvOnBoot(): void {
  const isProd = process.env.NODE_ENV === 'production';

  const missingAuth = PROD_REQUIRED.filter((key) => read(key) === undefined);
  const appSecretKey = read('APP_SECRET_KEY');
  const appSecretMissing = appSecretKey === undefined;
  const appSecretTooShort =
    appSecretKey !== undefined && appSecretKey.length < APP_SECRET_KEY_MIN_LENGTH;

  const fatal: string[] = [];
  if (isProd) {
    if (missingAuth.length > 0) {
      fatal.push(`Missing required auth env vars: ${missingAuth.join(', ')}.`);
    }
    if (appSecretMissing) {
      fatal.push(
        'APP_SECRET_KEY is required in production. Generate with `openssl rand -base64 48`.',
      );
    } else if (appSecretTooShort) {
      fatal.push(
        `APP_SECRET_KEY must be at least ${APP_SECRET_KEY_MIN_LENGTH} characters (got ${appSecretKey.length}).`,
      );
    }
    if (fatal.length > 0) {
      throw new Error(`Production startup blocked. ${fatal.join(' ')}`);
    }
    return;
  }

  // Dev path — non-fatal warnings.
  if (missingAuth.length > 0) {
    console.warn(
      '[env] AUTH_SECRET not set — Auth.js will generate an ephemeral signing secret for this process. Sessions will invalidate on restart.',
    );
  }
  if (appSecretMissing) {
    console.warn(
      '[env] APP_SECRET_KEY not set — secret-cipher will use the dev fallback key. Encrypted tenant credentials will NOT decrypt across machines.',
    );
  } else if (appSecretTooShort) {
    console.warn(
      `[env] APP_SECRET_KEY is shorter than ${APP_SECRET_KEY_MIN_LENGTH} characters. Production will refuse to boot — fix before deploying.`,
    );
  }
}
