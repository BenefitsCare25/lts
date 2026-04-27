// =============================================================
// prisma/seed.ts
//
// S4: creates one demo tenant ("Acme Brokers") so the app has
// a tenant row to target in integration tests and local dev.
//
// Full seeding of Global Reference, Operator Library, default
// EmployeeSchema, and the 12 ProductType catalogue rows lands
// across Stories S6, S7, S11, S16 of
// docs/PHASE_1_BUILD_PLAN_v2.md.
// =============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme-brokers' },
    update: {},
    create: {
      name: 'Acme Brokers',
      slug: 'acme-brokers',
    },
  });

  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log(`[seed] demo tenant: ${tenant.name} (${tenant.id})`);
  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log('[seed] S6/S7/S11/S16 seeds pending their respective stories.');
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
