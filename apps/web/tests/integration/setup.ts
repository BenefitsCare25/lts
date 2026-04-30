// =============================================================
// Integration test setup — DB-backed tRPC harness.
//
// Tests that depend on a real Postgres connect via INTEGRATION_DATABASE_URL.
// Without that env var, the test files using `runIfIntegration` skip
// entirely so `pnpm test` on a dev box doesn't truncate the dev DB.
//
// CI sets INTEGRATION_DATABASE_URL via the postgres service container.
//
// Two roles are exercised:
//   - INTEGRATION_DATABASE_URL — the migration/seed role (typically
//     the postgres superuser). Used by `truncateAll()`, `seedTwoTenants()`,
//     and any direct DB assertion that must NOT be filtered by RLS.
//   - INTEGRATION_DATABASE_URL_APP — an `app_user` (non-superuser)
//     connection. When set, `rlsAppPrisma` is constructed against it
//     and exposed to the cross-tenant suite so RLS policies actually
//     apply (superusers bypass RLS even with FORCE ROW LEVEL SECURITY).
//     If this is unset, RLS-as-app-user assertions are silently
//     skipped — the middleware-only assertions still run.
//
// Migrations are expected to have run before the test process starts
// (CI runs `prisma migrate deploy` in a separate step). The
// 20260430120000 migration creates the `app_user` role with grants.
// Set the password and update INTEGRATION_DATABASE_URL_APP to match.
// =============================================================

import type { Session, SessionUser } from '@/server/auth/session';
import { appRouter } from '@/server/trpc/router';
import { PrismaClient } from '@prisma/client';

const INTEGRATION_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const INTEGRATION_DATABASE_URL_APP = process.env.INTEGRATION_DATABASE_URL_APP;

export const integrationEnabled = Boolean(INTEGRATION_DATABASE_URL);
export const rlsAppRoleEnabled = Boolean(INTEGRATION_DATABASE_URL_APP);

// Lazily construct a Prisma client pointed at the test DB.
// Defining `datasourceUrl` overrides DATABASE_URL for this client only,
// which keeps any module-level `prisma` import in app code from
// accidentally reading the test DB during tests that don't opt in.
const testPrisma = new PrismaClient(
  INTEGRATION_DATABASE_URL ? { datasourceUrl: INTEGRATION_DATABASE_URL } : undefined,
);

// Separate Prisma client connected as `app_user` (non-superuser).
// Only this client honours RLS; testPrisma above bypasses RLS because
// it's connected as the migration/seed role.
const rlsAppPrisma = INTEGRATION_DATABASE_URL_APP
  ? new PrismaClient({ datasourceUrl: INTEGRATION_DATABASE_URL_APP })
  : null;

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
  // Tenant has no tenantId column and isn't RLS-scoped — create first
  // outside the transaction so we have its id to set as the RLS scope.
  const tenant = await testPrisma.tenant.create({
    data: { name: `Tenant ${slug}`, slug: `${slug}-${Date.now()}-${Math.random()}` },
  });

  // Wrap the rest in a transaction so `set_config('app.current_tenant_id', …)`
  // stays bound to a single connection across every insert. Without
  // the transaction, Prisma's connection pool may hand out a fresh
  // connection without the GUC set, and once RLS is enforced under a
  // non-superuser role the WITH CHECK clauses would reject the writes.
  return testPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, false)`;

    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: `${slug}-${Date.now()}@test.local`,
        role: 'BROKER_ADMIN',
      },
    });

    const insurer = await tx.insurer.create({
      data: {
        tenantId: tenant.id,
        name: `${slug} Insurer`,
        code: 'TM_LIFE',
        productsSupported: ['GTL', 'GHS'],
        claimFeedProtocol: 'IHP',
        active: true,
      },
    });

    const client = await tx.client.create({
      data: {
        tenantId: tenant.id,
        legalName: `${slug} Client Pte Ltd`,
        uen: '123456789K',
        countryOfIncorporation: 'SG',
        address: '1 Marina Bay',
        status: 'ACTIVE',
      },
    });

    const policy = await tx.policy.create({
      data: { clientId: client.id, name: `${slug} Group Policy` },
    });

    const benefitYear = await tx.benefitYear.create({
      data: {
        policyId: policy.id,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        state: 'DRAFT',
      },
    });

    const employee = await tx.employee.create({
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
  });
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

export { rlsAppPrisma, testPrisma };
