// =============================================================
// tenant-ai-provider integration tests (DB-backed).
//
// Guards the BYOK upsert/getMasked path against three concrete
// regressions:
//   1. The plaintext API key must never be returned by getMasked.
//   2. keyLastFour must reflect the saved key.
//   3. The stored ciphertext must round-trip through decryptSecret
//      (i.e. encryptSecret didn't quietly fail).
//
// Skipped unless INTEGRATION_DATABASE_URL is set.
// =============================================================

import { decryptSecret } from '@/server/security/secret-cipher';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type TwoTenants,
  callerFor,
  integrationEnabled,
  seedTwoTenants,
  testPrisma,
  truncateAll,
} from './setup';

const itIf = integrationEnabled ? it : it.skip;
const describeIf = integrationEnabled ? describe : describe.skip;

describeIf('tenant-ai-provider (DB-backed)', () => {
  let tenants: TwoTenants;

  beforeAll(async () => {
    // Pin a deterministic master key for the test process so the
    // ciphertext we read back via testPrisma can decrypt with the
    // same key the router used to encrypt.
    process.env.APP_SECRET_KEY = 'integration-test-key-do-not-use-anywhere-else-32+chars';
    await truncateAll();
    tenants = await seedTwoTenants();
  });

  itIf('upsert encrypts the key and getMasked never returns plaintext', async () => {
    const a = callerFor(tenants.a.userId);
    const apiKey = 'sk-azure-foundry-PLAINTEXT-DO-NOT-LEAK-1234';

    const masked = await a.tenantAiProvider.upsert({
      endpoint: 'https://my-resource.services.ai.azure.com',
      deploymentName: 'gpt-4o',
      apiVersion: '2024-10-21',
      apiKey,
    });

    // The masked shape must not contain the plaintext anywhere.
    const serialised = JSON.stringify(masked);
    expect(serialised).not.toContain('PLAINTEXT-DO-NOT-LEAK');
    expect(serialised).not.toContain('apiKey');
    expect(serialised).not.toContain('encryptedKey');

    expect(masked.configured).toBe(true);
    expect(masked.endpoint).toBe('https://my-resource.services.ai.azure.com');
    expect(masked.deploymentName).toBe('gpt-4o');
    expect(masked.apiVersion).toBe('2024-10-21');
    expect(masked.keyLastFour).toBe('1234');
  });

  itIf('getMasked round-trip matches upsert without exposing plaintext', async () => {
    const a = callerFor(tenants.a.userId);
    const fetched = await a.tenantAiProvider.getMasked();
    expect(JSON.stringify(fetched)).not.toContain('PLAINTEXT-DO-NOT-LEAK');
    expect(fetched.configured).toBe(true);
    expect(fetched.keyLastFour).toBe('1234');
  });

  itIf('stored ciphertext decrypts back to the original plaintext', async () => {
    // Direct DB read (bypassing RLS via the seed-role testPrisma) to
    // confirm the row stores ciphertext, not plaintext, and that the
    // round-trip via decryptSecret returns the original key.
    const row = await testPrisma.tenantAiProvider.findFirst({
      where: { tenantId: tenants.a.tenantId },
    });
    expect(row).not.toBeNull();
    if (!row) return;

    expect(row.encryptedKey).not.toContain('PLAINTEXT-DO-NOT-LEAK');
    expect(row.encryptedKey.startsWith('v1.')).toBe(true);
    expect(decryptSecret(row.encryptedKey)).toBe('sk-azure-foundry-PLAINTEXT-DO-NOT-LEAK-1234');
  });

  itIf('endpoint normalisation collapses a project URL to its origin', async () => {
    const a = callerFor(tenants.a.userId);
    const masked = await a.tenantAiProvider.upsert({
      endpoint: 'https://my-resource.services.ai.azure.com/api/projects/my-project/',
      deploymentName: 'claude-3-5-sonnet',
      apiVersion: '2024-10-21',
      apiKey: 'sk-azure-foundry-test-NORMALISE-9999',
    });
    expect(masked.endpoint).toBe('https://my-resource.services.ai.azure.com');
    expect(masked.keyLastFour).toBe('9999');
  });

  itIf('clear deletes the stored credentials', async () => {
    const a = callerFor(tenants.a.userId);
    const result = await a.tenantAiProvider.clear();
    expect(result).toEqual({ cleared: true });

    const after = await a.tenantAiProvider.getMasked();
    expect(after.configured).toBe(false);
    expect(after.keyLastFour).toBeNull();
  });

  itIf('cross-tenant isolation: tenant A cannot see tenant B credentials', async () => {
    // Tenant B sets up creds.
    const b = callerFor(tenants.b.userId);
    await b.tenantAiProvider.upsert({
      endpoint: 'https://b-resource.services.ai.azure.com',
      deploymentName: 'gpt-4o',
      apiVersion: '2024-10-21',
      apiKey: 'sk-tenant-b-secret-key-2222',
    });

    // Tenant A's getMasked must not surface tenant B's row.
    const a = callerFor(tenants.a.userId);
    const seen = await a.tenantAiProvider.getMasked();
    expect(seen.configured).toBe(false);
    expect(seen.keyLastFour).toBeNull();
  });
});
