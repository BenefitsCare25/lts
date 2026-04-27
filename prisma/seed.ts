// =============================================================
// prisma/seed.ts
//
// Execution order (idempotent — safe to re-run):
//   S4:  demo Tenant ("Acme Brokers")
//   S6:  Global Reference — Country (249), Currency (9), Industry (SSIC 2020)
//   S7:  Operator Library — 6 data type rows
//
// Full catalogue seeds (S11 EmployeeSchema, S16 ProductTypes)
// are added by their own stories.
// =============================================================

import { PrismaClient } from '@prisma/client';
import { seedCountries, seedCurrencies, seedIndustries } from './seeds/global-reference';
import { seedOperatorLibrary } from './seeds/operators';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // S4 — demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme-brokers' },
    update: {},
    create: { name: 'Acme Brokers', slug: 'acme-brokers' },
  });
  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log(`[seed] demo tenant: ${tenant.name} (${tenant.id})`);

  // S6 — Global Reference
  await seedCountries(prisma);
  await seedCurrencies(prisma);
  await seedIndustries(prisma);

  // S7 — Operator Library
  await seedOperatorLibrary(prisma);

  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log('[seed] done.');
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
