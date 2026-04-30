// =============================================================
// Reference data router (S6 — Global Reference seeding consumer).
//
// Country, Currency, and Industry are system-level (not tenant-
// scoped), so these queries use protectedProcedure rather than
// tenantProcedure: signed in is enough, no tenant filter needed.
//
// Used by Screen 1 (client onboarding) for country + industry
// dropdowns, and Screen 2 for currency dropdown.
// =============================================================

import { prisma } from '@/server/db/client';
import { protectedProcedure, router } from '../init';

export const referenceDataRouter = router({
  countries: protectedProcedure.query(() =>
    prisma.country.findMany({
      orderBy: { name: 'asc' },
      select: { code: true, name: true, uenPattern: true },
    }),
  ),

  currencies: protectedProcedure.query(() =>
    prisma.currency.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, name: true, decimals: true },
    }),
  ),

  industries: protectedProcedure.query(() =>
    prisma.industry.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, name: true, parentCode: true },
    }),
  ),

  // OperatorLibrary is system-level seed data shared across tenants.
  // The predicate builder consumes it to populate the operator
  // dropdown filtered by the chosen field's data type.
  operators: protectedProcedure.query(() =>
    prisma.operatorLibrary.findMany({
      select: { dataType: true, operators: true },
    }),
  ),
});
