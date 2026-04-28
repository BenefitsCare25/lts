// =============================================================
// Integration test setup — DB-backed tRPC harness.
//
// Tests that depend on a real Postgres connect via INTEGRATION_DATABASE_URL.
// Without that env var, the test files using `runIfIntegration` skip
// entirely so `pnpm test` on a dev box doesn't truncate the dev DB.
//
// CI sets INTEGRATION_DATABASE_URL via the postgres service container.
//
// Migrations are expected to have run before the test process starts
// (CI runs `prisma migrate deploy` in a separate step). Each test
// file that uses `truncateAll()` is responsible for re-seeding what
// it needs.
// =============================================================

import type { Session, SessionUser } from '@/server/auth/session';
import { appRouter } from '@/server/trpc/router';
import { PrismaClient } from '@prisma/client';

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;

export const integrationEnabled = Boolean(INTEGRATION_DATABASE_URL);

// Lazily construct a Prisma client pointed at the test DB.
// Defining `datasourceUrl` overrides DATABASE_URL for this client only,
// which keeps any module-level `prisma` import in app code from
// accidentally reading the test DB during tests that don't opt in.
const testPrisma = new PrismaClient(
  INTEGRATION_DATABASE_URL ? { datasourceUrl: INTEGRATION_DATABASE_URL } : undefined,
);

// Truncate every table in dependency order. Postgres-specific.
// CASCADE is implicit per RESTART IDENTITY CASCADE; we still order the
// list so any FK without ON DELETE CASCADE doesn't surprise us.
const TABLES_LEAF_FIRST = [
  'Enrollment',
  'Dependent',
  'Employee',
  'PremiumRate',
  'ProductEligibility',
  'Plan',
  'Product',
  'BenefitGroup',
  'PolicyEntity',
  'BenefitYear',
  'Policy',
  'Client',
  'PlacementSlipUpload',
  'PoolMembership',
  'Pool',
  'TPA',
  'Insurer',
  'ProductType',
  'EmployeeSchema',
  'AuditLog',
  'User',
  'Tenant',
];

export async function truncateAll(): Promise<void> {
  if (!integrationEnabled) return;
  const quoted = TABLES_LEAF_FIRST.map((t) => `"${t}"`).join(', ');
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
}

export type SeededTenant = {
  tenantId: string;
  userId: string;
  insurerId: string;
  clientId: string;
  policyId: string;
  benefitYearId: string;
  employeeId: string;
};

export type TwoTenants = {
  a: SeededTenant;
  b: SeededTenant;
};

// Seeds two parallel tenants with overlapping shapes so cross-tenant
// reads have something to leak. All ids are randomised by Prisma's
// cuid default; the reference data (Country/Industry) is seeded
// minimally because clients can be inserted directly without going
// through the API validator that requires those rows.
export async function seedTwoTenants(): Promise<TwoTenants> {
  // Reference data — needed only because some routers join to it.
  await testPrisma.country.upsert({
    where: { code: 'SG' },
    update: {},
    create: { code: 'SG', name: 'Singapore', uenPattern: '^[0-9]{8,10}[A-Z]$' },
  });

  return {
    a: await seedOneTenant('test-a'),
    b: await seedOneTenant('test-b'),
  };
}

async function seedOneTenant(slug: string): Promise<SeededTenant> {
  const tenant = await testPrisma.tenant.create({
    data: { name: `Tenant ${slug}`, slug: `${slug}-${Date.now()}-${Math.random()}` },
  });

  const user = await testPrisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `${slug}-${Date.now()}@test.local`,
      role: 'BROKER_ADMIN',
    },
  });

  const insurer = await testPrisma.insurer.create({
    data: {
      tenantId: tenant.id,
      name: `${slug} Insurer`,
      code: 'TM_LIFE',
      productsSupported: ['GTL', 'GHS'],
      claimFeedProtocol: 'IHP',
      active: true,
    },
  });

  const client = await testPrisma.client.create({
    data: {
      tenantId: tenant.id,
      legalName: `${slug} Client Pte Ltd`,
      uen: '123456789K',
      countryOfIncorporation: 'SG',
      address: '1 Marina Bay',
      status: 'ACTIVE',
    },
  });

  const policy = await testPrisma.policy.create({
    data: { clientId: client.id, name: `${slug} Group Policy` },
  });

  const benefitYear = await testPrisma.benefitYear.create({
    data: {
      policyId: policy.id,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      state: 'DRAFT',
    },
  });

  const employee = await testPrisma.employee.create({
    data: {
      clientId: client.id,
      data: { 'employee.email': `${slug}-emp@test.local` },
      hireDate: new Date('2026-01-01'),
      status: 'ACTIVE',
    },
  });

  return {
    tenantId: tenant.id,
    userId: user.id,
    insurerId: insurer.id,
    clientId: client.id,
    policyId: policy.id,
    benefitYearId: benefitYear.id,
    employeeId: employee.id,
  };
}

// Build a tRPC caller for a given userId. The session.user.tenantId
// here is unused — requireTenantContext() re-reads tenantId from the
// User row to defend against a tampered session.
export function callerFor(userId: string) {
  const sessionUser: SessionUser = {
    id: userId,
    email: `${userId}@test.local`,
    tenantId: '',
    role: 'BROKER_ADMIN',
    firstName: null,
    lastName: null,
    roles: ['BROKER_ADMIN'],
  };
  const session: Session = { user: sessionUser };
  return appRouter.createCaller({ session });
}

export { testPrisma };
