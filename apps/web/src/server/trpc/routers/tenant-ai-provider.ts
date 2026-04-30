// =============================================================
// TenantAiProvider router — per-tenant Azure AI Foundry config.
//
// Design:
//   - getMasked: any tenant user — returns endpoint, deployment,
//                apiVersion, last 4 chars of key, updatedAt. NEVER
//                returns the plaintext key.
//   - upsert:    adminProcedure — encrypts the supplied key with
//                AES-256-GCM (server/security/secret-cipher.ts) and
//                writes the row.
//   - clear:     adminProcedure — deletes the row.
//   - test:      adminProcedure — decrypts the stored key and makes
//                a tiny chat-completions request to the tenant's
//                Azure AI Foundry endpoint to verify the credentials
//                work. Returns ok/error; never echoes the key.
//
// The plaintext key only exists in memory during upsert (for the
// short window between Zod parse and encryptSecret) and during test
// (for the duration of one HTTP call). Audit logs capture the action
// but the input payload is redacted via the Audit middleware's
// `deriveEntity` path — the encrypted ciphertext is fine to log if
// it appears, since it requires APP_SECRET_KEY to decrypt.
// =============================================================

import { decryptSecret, encryptSecret, lastFour } from '@/server/security/secret-cipher';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, router, tenantProcedure } from '../init';

const endpointSchema = z
  .string()
  .trim()
  .url('Endpoint must be a full URL, e.g. https://my-resource.services.ai.azure.com')
  .max(300)
  // Strip a trailing slash for a stable canonical form.
  .transform((s) => s.replace(/\/+$/, ''));

const deploymentNameSchema = z
  .string()
  .trim()
  .min(1, 'Deployment name is required.')
  .max(120)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dot, dash, underscore.');

const apiVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}(?:-preview)?$/, 'Format: YYYY-MM-DD or YYYY-MM-DD-preview');

const apiKeySchema = z
  .string()
  // Foundry / OpenAI keys are typically 32+ chars; be lenient on
  // lower bound for forward compatibility.
  .min(20, 'API key looks too short.')
  .max(500);

const upsertInputSchema = z.object({
  endpoint: endpointSchema,
  deploymentName: deploymentNameSchema,
  apiVersion: apiVersionSchema.default('2024-08-01-preview'),
  apiKey: apiKeySchema,
});

interface MaskedAiProvider {
  configured: boolean;
  provider: string | null;
  endpoint: string | null;
  deploymentName: string | null;
  apiVersion: string | null;
  keyLastFour: string | null;
  active: boolean;
  updatedAt: Date | null;
}

async function readMasked(
  db: import('@/server/db/tenant').TenantDb,
): Promise<MaskedAiProvider> {
  const row = await db.tenantAiProvider.findFirst();
  if (!row) {
    return {
      configured: false,
      provider: null,
      endpoint: null,
      deploymentName: null,
      apiVersion: null,
      keyLastFour: null,
      active: false,
      updatedAt: null,
    };
  }
  return {
    configured: true,
    provider: row.provider,
    endpoint: row.endpoint,
    deploymentName: row.deploymentName,
    apiVersion: row.apiVersion,
    keyLastFour: row.keyLastFour,
    active: row.active,
    updatedAt: row.updatedAt,
  };
}

// Tiny ping to the configured Azure AI Foundry chat-completions
// endpoint. Validates that endpoint + deployment + key all work
// together. Returns plain ok/error so the UI can render a status
// chip without surfacing the raw key.
async function pingAzureAiFoundry(args: {
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
  apiKey: string;
}): Promise<{ ok: true; latencyMs: number } | { ok: false; status: number; error: string }> {
  // Azure AI Foundry exposes both the OpenAI-compatible Azure OpenAI
  // path and the newer Azure AI Inference path. We use the OpenAI
  // path (deployment-scoped) because every Foundry resource exposes
  // it and most tenants will be migrating from Azure OpenAI.
  const url = `${args.endpoint}/openai/deployments/${encodeURIComponent(
    args.deploymentName,
  )}/chat/completions?api-version=${encodeURIComponent(args.apiVersion)}`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': args.apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      // Don't hang the broker UI — 10s is more than enough for a
      // 1-token response.
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - started;
    if (response.ok) return { ok: true, latencyMs };
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      error: text.slice(0, 400) || `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

export const tenantAiProviderRouter = router({
  getMasked: tenantProcedure.query(({ ctx }) => readMasked(ctx.db)),

  upsert: adminProcedure
    .input(upsertInputSchema)
    .mutation(async ({ ctx, input }): Promise<MaskedAiProvider> => {
      const encryptedKey = encryptSecret(input.apiKey);
      const keyLastFour = lastFour(input.apiKey);
      const existing = await ctx.db.tenantAiProvider.findFirst();
      if (existing) {
        await ctx.db.tenantAiProvider.update({
          where: { id: existing.id },
          data: {
            endpoint: input.endpoint,
            deploymentName: input.deploymentName,
            apiVersion: input.apiVersion,
            encryptedKey,
            keyLastFour,
            active: true,
            updatedById: ctx.userId,
          },
        });
      } else {
        await ctx.db.tenantAiProvider.create({
          data: {
            tenantId: ctx.tenantId,
            provider: 'azure_ai_foundry',
            endpoint: input.endpoint,
            deploymentName: input.deploymentName,
            apiVersion: input.apiVersion,
            encryptedKey,
            keyLastFour,
            active: true,
            updatedById: ctx.userId,
          },
        });
      }
      return readMasked(ctx.db);
    }),

  clear: adminProcedure.mutation(async ({ ctx }) => {
    await ctx.db.tenantAiProvider.deleteMany();
    return { cleared: true };
  }),

  // Validates the saved credentials by hitting Azure AI Foundry.
  // The plaintext key is held in memory only for the duration of
  // this call. Returns a structured result so the UI can render a
  // success / failure chip; never returns the key itself.
  test: adminProcedure.mutation(async ({ ctx }) => {
    const row = await ctx.db.tenantAiProvider.findFirst();
    if (!row) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No AI provider configured for this tenant.',
      });
    }
    let plaintextKey: string;
    try {
      plaintextKey = decryptSecret(row.encryptedKey);
    } catch {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'Stored key could not be decrypted. APP_SECRET_KEY may have changed since it was saved. Re-enter the API key to fix.',
      });
    }
    const result = await pingAzureAiFoundry({
      endpoint: row.endpoint,
      deploymentName: row.deploymentName,
      apiVersion: row.apiVersion,
      apiKey: plaintextKey,
    });
    return result;
  }),
});
