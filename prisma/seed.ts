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
import { hash } from 'bcryptjs';
import { seedCountries, seedCurrencies, seedIndustries } from './seeds/global-reference';
import { seedOperatorLibrary } from './seeds/operators';

const prisma = new PrismaClient();

// Dev admin credentials. Override via SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
// when seeding a real environment. The default is intentionally weak — only
// safe for ephemeral dev/staging where Container Apps ingress is not public-
// indexed yet.
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@acme-brokers.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';

async function main(): Promise<void> {
  // S4 — demo tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme-brokers' },
    update: {},
    create: { name: 'Acme Brokers', slug: 'acme-brokers' },
  });
  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log(`[seed] demo tenant: ${tenant.name} (${tenant.id})`);

  // Dev admin user — Auth.js Credentials provider validates against this.
  const passwordHash = await hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash, role: 'TENANT_ADMIN', tenantId: tenant.id },
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: 'TENANT_ADMIN',
      tenantId: tenant.id,
    },
  });
  // biome-ignore lint/suspicious/noConsoleLog: intentional seed output
  console.log(`[seed] dev admin: ${admin.email}`);

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
