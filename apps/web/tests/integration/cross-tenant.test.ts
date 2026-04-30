// =============================================================
// Cross-tenant isolation regression test.
//
// Why this exists. On 2026-04-28 a CRITICAL leak landed in
// claims-feed.ingest where the inner findFirst on Insurer skipped
// the tenantId join — a signed-in user from tenant A could submit
// an insurerId from tenant B and silently parse claims against
// the wrong tenant's data. The fix re-introduced the assertion;
// this test guards against the next instance of the same class
// of bug.
//
// Scope. For every router whose context exposes data, the test
// signs in as user-A and exercises the endpoints with ids that
// belong to tenant B. Every call must either return NOT_FOUND
// or omit tenant-B rows entirely (for list endpoints).
//
// Skipped unless INTEGRATION_DATABASE_URL is set — see setup.ts.
// =============================================================

import { TRPCError } from '@trpc/server';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type TwoTenants,
  callerFor,
  integrationEnabled,
  seedTwoTenants,
  testPrisma,
  truncateAll,
} from './setup';

// vitest's runIf pattern lets us skip the entire suite without
// emitting a "0 tests passed" placeholder.
const itIf = integrationEnabled ? it : it.skip;
const describeIf = integrationEnabled ? describe : describe.skip;

describeIf('cross-tenant isolation (DB-backed)', () => {
  let tenants: TwoTenants;

  beforeAll(async () => {
    await truncateAll();
    tenants = await seedTwoTenants();
  });

  // -------- insurers --------------------------------------------
  describe('insurers', () => {
    itIf('list returns only own tenant rows', async () => {
      const a = callerFor(tenants.a.userId);
      const list = await a.insurers.list();
      const ids = list.map((i) => i.id);
      expect(ids).toContain(tenants.a.insurerId);
      expect(ids).not.toContain(tenants.b.insurerId);
    });

    itIf('byId throws NOT_FOUND for another tenant id', async () => {
      const a = callerFor(tenants.a.userId);
      await expect(a.insurers.byId({ id: tenants.b.insurerId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    itIf('update on another tenant id throws NOT_FOUND and leaves the row unchanged', async () => {
      const a = callerFor(tenants.a.userId);
      const before = await testPrisma.insurer.findUniqueOrThrow({
        where: { id: tenants.b.insurerId },
      });
      await expect(
        a.insurers.update({
          id: tenants.b.insurerId,
          data: {
            name: 'TAMPERED',
            code: 'TAMPERED',
            productsSupported: ['GTL'],
            claimFeedProtocol: null,
            active: false,
          },
        }),
      ).rejects.toBeInstanceOf(TRPCError);
      const after = await testPrisma.insurer.findUniqueOrThrow({
        where: { id: tenants.b.insurerId },
      });
      expect(after.name).toBe(before.name);
      expect(after.code).toBe(before.code);
    });

    itIf('delete on another tenant id throws NOT_FOUND and leaves the row in place', async () => {
      const a = callerFor(tenants.a.userId);
      await expect(a.insurers.delete({ id: tenants.b.insurerId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const stillThere = await testPrisma.insurer.findUnique({
        where: { id: tenants.b.insurerId },
      });
      expect(stillThere).not.toBeNull();
    });
  });

  // -------- clients ---------------------------------------------
  describe('clients', () => {
    itIf('list returns only own tenant rows', async () => {
      const a = callerFor(tenants.a.userId);
      const list = await a.clients.list();
      const ids = list.map((c) => c.id);
      expect(ids).toContain(tenants.a.clientId);
      expect(ids).not.toContain(tenants.b.clientId);
    });

    itIf('byId throws NOT_FOUND for another tenant id', async () => {
      const a = callerFor(tenants.a.userId);
      await expect(a.clients.byId({ id: tenants.b.clientId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // -------- policies --------------------------------------------
  describe('policies', () => {
    itIf("listByClient with another tenant's clientId throws NOT_FOUND", async () => {
      const a = callerFor(tenants.a.userId);
      await expect(a.policies.listByClient({ clientId: tenants.b.clientId })).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
    });

    itIf('byId throws NOT_FOUND for another tenant policy id', async () => {
      const a = callerFor(tenants.a.userId);
      await expect(a.policies.byId({ id: tenants.b.policyId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // -------- benefitYears ----------------------------------------
  describe('benefitYears', () => {
    itIf("listByPolicy with another tenant's policyId throws NOT_FOUND", async () => {
      const a = callerFor(tenants.a.userId);
      await expect(
        a.benefitYears.listByPolicy({ policyId: tenants.b.policyId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    itIf('byId throws NOT_FOUND for another tenant benefitYear id', async () => {
      const a = callerFor(tenants.a.userId);
      await expect(a.benefitYears.byId({ id: tenants.b.benefitYearId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // -------- employees -------------------------------------------
  describe('employees', () => {
    itIf("listByClient with another tenant's clientId throws NOT_FOUND", async () => {
      const a = callerFor(tenants.a.userId);
      await expect(
        a.employees.listByClient({ clientId: tenants.b.clientId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    itIf('byId throws NOT_FOUND for another tenant employee id', async () => {
      const a = callerFor(tenants.a.userId);
      await expect(a.employees.byId({ id: tenants.b.employeeId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // -------- claimsFeed (the regression that motivated this suite)
  describe('claimsFeed', () => {
    const csv = Buffer.from('memberId,claimDate,productCode,amount\n').toString('base64');

    itIf("ingest with another tenant's insurerId throws NOT_FOUND", async () => {
      const a = callerFor(tenants.a.userId);
      await expect(
        a.claimsFeed.ingest({
          insurerId: tenants.b.insurerId,
          clientId: tenants.a.clientId,
          contentBase64: csv,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    itIf("ingest with another tenant's clientId throws NOT_FOUND", async () => {
      const a = callerFor(tenants.a.userId);
      await expect(
        a.claimsFeed.ingest({
          insurerId: tenants.a.insurerId,
          clientId: tenants.b.clientId,
          contentBase64: csv,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // -------- placementSlips --------------------------------------
  describe('placementSlips', () => {
    itIf("listByClient with another tenant's clientId throws NOT_FOUND", async () => {
      const a = callerFor(tenants.a.userId);
      await expect(
        a.placementSlips.listByClient({ clientId: tenants.b.clientId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
