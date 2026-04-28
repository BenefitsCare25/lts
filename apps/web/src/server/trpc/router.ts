// =============================================================
// Root tRPC router — composes feature routers.
//
// Add new feature routers (catalogue, clients, policies, …) by
// importing them and listing them in the router({...}) below.
// Type AppRouter is the single shared client-side handle.
// =============================================================

import { router } from './init';
import { clientsRouter } from './routers/clients';
import { employeeSchemaRouter } from './routers/employee-schema';
import { healthRouter } from './routers/health';
import { insurersRouter } from './routers/insurers';
import { poolsRouter } from './routers/pools';
import { productTypesRouter } from './routers/product-types';
import { referenceDataRouter } from './routers/reference-data';
import { tpasRouter } from './routers/tpas';

export const appRouter = router({
  health: healthRouter,
  insurers: insurersRouter,
  pools: poolsRouter,
  tpas: tpasRouter,
  employeeSchema: employeeSchemaRouter,
  productTypes: productTypesRouter,
  clients: clientsRouter,
  referenceData: referenceDataRouter,
});

export type AppRouter = typeof appRouter;
