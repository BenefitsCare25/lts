// =============================================================
// Root tRPC router — composes feature routers.
//
// Add new feature routers (catalogue, clients, policies, …) by
// importing them and listing them in the router({...}) below.
// Type AppRouter is the single shared client-side handle.
// =============================================================

import { router } from './init';
import { healthRouter } from './routers/health';

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
