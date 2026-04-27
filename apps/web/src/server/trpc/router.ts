// =============================================================
// Root tRPC router — composes feature routers.
//
// Add new feature routers (catalogue, clients, policies, …) by
// importing them and listing them in the router({...}) below.
// Type AppRouter is the single shared client-side handle.
// =============================================================

import { router } from './init';
import { healthRouter } from './routers/health';
import { insurersRouter } from './routers/insurers';
import { tpasRouter } from './routers/tpas';

export const appRouter = router({
  health: healthRouter,
  insurers: insurersRouter,
  tpas: tpasRouter,
});

export type AppRouter = typeof appRouter;
