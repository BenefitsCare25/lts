// =============================================================
// Health router — liveness signal for tRPC wiring.
//
// One procedure, no auth. Used by /api/health/trpc and the
// home page client-side to confirm the round-trip is wired up.
// Real health checks (DB, Redis) land alongside their stories.
// =============================================================

import { publicProcedure, router } from '../init';

export const healthRouter = router({
  ping: publicProcedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
  })),
});
