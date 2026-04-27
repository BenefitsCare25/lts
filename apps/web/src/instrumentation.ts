// Next.js instrumentation hook — runs once on server startup.
// Starts BullMQ workers when REDIS_URL is configured.
// NEXT_RUNTIME guard ensures this only runs in Node.js (not Edge).

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWorker } = await import('@/server/jobs/worker');
    startWorker();
  }
}
