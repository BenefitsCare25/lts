// =============================================================
// RLS-as-app-role regression test.
//
// The cross-tenant.test.ts suite exercises the application-layer
// tenant filter (Prisma extension + explicit FK joins). It runs
// as the migration role, which is typically the postgres superuser
// — superusers bypass RLS even with FORCE ROW LEVEL SECURITY, so
// that suite alone does NOT prove the database-layer policies work.
//
// This file fills that gap. It uses a separate Prisma connection
// (`rlsAppPrisma`) wired to a non-superuser role (`app_user`,
// created by migration 20260430120000_app_user_role_and_force_rls).
// Every assertion bypasses the application layer and queries the
// raw tables — if RLS isn't actually applied, rows leak.
//
// Skipped unless both INTEGRATION_DATABASE_URL and
// INTEGRATION_DATABASE_URL_APP are set. Local dev gets a `console.warn`
// pointing at the env var so the gap is visible.
// =============================================================

import { beforeAll, describe, expect, it } from 'vitest';
import {
  type TwoTenants,
  rlsAppPrisma,
  rlsAppRoleEnabled,
  seedTwoTenants,
  testPrisma,
  truncateAll,
} from './setup';

const enabled = rlsAppRoleEnabled && rlsAppPrisma !== null;
const describeIf = enabled ? describe : describe.skip;
const itIf = enabled ? it : it.skip;

if (!enabled && process.env.INTEGRATION_DATABASE_URL) {
  console.warn(
    '[rls-app-role] Skipping RLS-as-app-user suite. Set INTEGRATION_DATABASE_URL_APP to a connection string for a non-superuser role (e.g. `app_user`) to exercise database-layer policies.',
  );
}

describeIf('RLS enforced under app_user role (DB-backed)', () => {
  let tenants: TwoTenants;

  beforeAll(async () => {
    await truncateAll();
    tenants = await seedTwoTenants();
  });

  // The set_config call binds the tenant scope to a single connection.
  // Prisma's $transaction guarantees connection affinity inside the
  // callback; outside a transaction, two queries can land on different
  // connections in the pool and the second one will have an unset GUC.
  async function asTenant<T>(
    tenantId: string,
    fn: (tx: NonNullable<typeof rlsAppPrisma>) => Promise<T>,
  ): Promise<T> {
    if (!rlsAppPrisma) throw new Error('rlsAppPrisma not initialised');
    return rlsAppPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      // The cast is safe — tx is a TransactionClient which exposes the
      // same model surface as PrismaClient for our purposes.
      return fn(tx as unknown as NonNullable<typeof rlsAppPrisma>);
    });
  }

  itIf('Insurer.findMany under tenant A returns only tenant A rows', async () => {
    const rows = await asTenant(tenants.a.tenantId, (tx) => tx.insurer.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(tenants.a.insurerId);
    expect(ids).not.toContain(tenants.b.insurerId);
  });

  itIf('Client.findMany under tenant A returns only tenant A rows', async () => {
    const rows = await asTenant(tenants.a.tenantId, (tx) => tx.client.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(tenants.a.clientId);
    expect(ids).not.toContain(tenants.b.clientId);
  });

  itIf(
    'Policy.findMany (indirect tenant) under tenant A returns only tenant A policies',
    async () => {
      const rows = await asTenant(tenants.a.tenantId, (tx) => tx.policy.findMany());
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(tenants.a.policyId);
      expect(ids).not.toContain(tenants.b.policyId);
    },
  );

  itIf('BenefitYear.findMany (indirect through Policy) is filtered', async () => {
    const rows = await asTenant(tenants.a.tenantId, (tx) => tx.benefitYear.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(tenants.a.benefitYearId);
    expect(ids).not.toContain(tenants.b.benefitYearId);
  });

  itIf('Employee.findMany (indirect through Client) is filtered', async () => {
    const rows = await asTenant(tenants.a.tenantId, (tx) => tx.employee.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(tenants.a.employeeId);
    expect(ids).not.toContain(tenants.b.employeeId);
  });

  itIf('findUnique on another tenant id returns null under RLS (not an error)', async () => {
    // Without RLS, findUnique returns the row by primary key. With RLS,
    // the row is invisible — findUnique returns null instead of throwing.
    const found = await asTenant(tenants.a.tenantId, (tx) =>
      tx.insurer.findUnique({ where: { id: tenants.b.insurerId } }),
    );
    expect(found).toBeNull();
  });

  itIf('UPDATE on another tenant row affects 0 rows', async () => {
    // updateMany returns count; under RLS, the row is invisible so
    // the count is 0. The row should be unchanged when read as the
    // migration role.
    const before = await testPrisma.insurer.findUniqueOrThrow({
      where: { id: tenants.b.insurerId },
    });
    const result = await asTenant(tenants.a.tenantId, (tx) =>
      tx.insurer.updateMany({
        where: { id: tenants.b.insurerId },
        data: { name: 'TAMPERED-VIA-RLS' },
      }),
    );
    expect(result.count).toBe(0);
    const after = await testPrisma.insurer.findUniqueOrThrow({
      where: { id: tenants.b.insurerId },
    });
    expect(after.name).toBe(before.name);
  });

  itIf('INSERT with a foreign tenantId is rejected by WITH CHECK', async () => {
    // The `tenant_isolation` policy's WITH CHECK clause rejects writes
    // whose tenantId disagrees with the current GUC. Even if app code
    // tried to forge a tenantId, the DB blocks the write.
    await expect(
      asTenant(tenants.a.tenantId, (tx) =>
        tx.insurer.create({
          data: {
            tenantId: tenants.b.tenantId, // wrong tenant — should fail
            name: 'cross-tenant-injection',
            code: 'INJECT',
            productsSupported: [],
            active: true,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  itIf('without GUC set, every read returns 0 rows', async () => {
    // Defensive check: the policy compares against the GUC. When the
    // GUC is unset (or empty string), no row matches, so RLS blocks
    // everything by default. This is the desired fail-safe behaviour
    // — connection pool reuse without re-binding can't leak.
    if (!rlsAppPrisma) throw new Error('rlsAppPrisma not initialised');
    // Use a fresh transaction without setting the GUC.
    const rows = await rlsAppPrisma.$transaction(async (tx) => {
      // Explicitly clear the GUC inside this transaction in case the
      // connection was last used with one set.
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', '', true)`;
      return tx.insurer.findMany();
    });
    expect(rows.length).toBe(0);
  });
});
