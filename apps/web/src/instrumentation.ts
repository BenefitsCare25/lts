// Next.js instrumentation hook — runs once on server startup.
// Validates required env (refuses to boot in prod with missing
// secrets), warms the secret-cipher master key (so the first
// AES-GCM call doesn't pay a synchronous scrypt cost on the
// request hot path), and starts BullMQ workers when configured.
// All work happens inside the NEXT_RUNTIME guard so the bundler
// can prove these imports never reach the Edge runtime.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Env validation — throws in prod when AUTH_SECRET or
    // APP_SECRET_KEY is missing/too short. Surfaces dev warnings.
    const { validateEnvOnBoot } = await import('@/server/env');
    validateEnvOnBoot();

    // Warm the AES-256-GCM master key derivation. scryptSync is
    // CPU-blocking; doing it once at startup keeps the first
    // encrypt/decrypt call on the request hot path off the critical
    // path. Wrapped so a missing APP_SECRET_KEY in dev (which falls
    // back to a fixed key + warning) doesn't break boot.
    try {
      const { warmMasterKey } = await import('@/server/security/secret-cipher');
      warmMasterKey();
    } catch (err) {
      console.warn(
        '[instrumentation] secret-cipher warm-up failed; first encrypt call will pay the scrypt cost.',
        err,
      );
    }

    // Start BullMQ worker (no-op when REDIS_URL is missing).
    const { startWorker } = await import('@/server/jobs/worker');
    startWorker();
  }
}
