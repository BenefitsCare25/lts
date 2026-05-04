// =============================================================
// Root tRPC router — composes feature routers.
//
// Add new feature routers (catalogue, clients, policies, …) by
// importing them and listing them in the router({...}) below.
// Type AppRouter is the single shared client-side handle.
// =============================================================

import { router } from './init';
import { benefitGroupsRouter } from './routers/benefit-groups';
import { benefitYearsRouter } from './routers/benefit-years';
import { claimsFeedRouter } from './routers/claims-feed';
import { clientsRouter } from './routers/clients';
import { employeeSchemaRouter } from './routers/employee-schema';
import { employeesRouter } from './routers/employees';
import { extractionDraftsRouter } from './routers/extraction-drafts';
import { healthRouter } from './routers/health';
import { insurersRouter } from './routers/insurers';
import { placementSlipsRouter } from './routers/placement-slips';
import { plansRouter } from './routers/plans';
import { policiesRouter } from './routers/policies';
import { poolsRouter } from './routers/pools';
import { portalRouter } from './routers/portal';
import { premiumRatesRouter } from './routers/premium-rates';
import { productEligibilityRouter } from './routers/product-eligibility';
import { productTypesRouter } from './routers/product-types';
import { productsRouter } from './routers/products';
import { referenceDataRouter } from './routers/reference-data';
import { reviewRouter } from './routers/review';
import { tenantAiProviderRouter } from './routers/tenant-ai-provider';
import { tpasRouter } from './routers/tpas';

export const appRouter = router({
  health: healthRouter,
  insurers: insurersRouter,
  pools: poolsRouter,
  tpas: tpasRouter,
  employeeSchema: employeeSchemaRouter,
  productTypes: productTypesRouter,
  clients: clientsRouter,
  policies: policiesRouter,
  benefitYears: benefitYearsRouter,
  benefitGroups: benefitGroupsRouter,
  products: productsRouter,
  plans: plansRouter,
  productEligibility: productEligibilityRouter,
  premiumRates: premiumRatesRouter,
  placementSlips: placementSlipsRouter,
  extractionDrafts: extractionDraftsRouter,
  employees: employeesRouter,
  claimsFeed: claimsFeedRouter,
  review: reviewRouter,
  referenceData: referenceDataRouter,
  tenantAiProvider: tenantAiProviderRouter,
  portal: portalRouter,
});

export type AppRouter = typeof appRouter;
