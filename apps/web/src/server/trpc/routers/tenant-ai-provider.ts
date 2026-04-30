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

// Reduce any Foundry URL the user might paste to its inference root
// (scheme + host). The portal shows two URLs prominently:
//   - resource (inference):  https://<res>.services.ai.azure.com
//   - project  (mgmt API):   https://<res>.services.ai.azure.com/api/projects/<name>
// Users naturally copy the project URL, which 400s with the misleading
// "API version not supported" when we append /openai/deployments/...
// because that path doesn't exist under /api/projects. Always collapse
// to the URL origin so the inference path is correct regardless of
// which one was pasted.
//
// Exported under __test__ so unit tests can assert the normalisation
// without spinning up the router; the leading underscore signals it
// is not a public API.
export function normalizeFoundryEndpoint(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

const endpointSchema = z
  .string()
  .trim()
  .url('Endpoint must be a full URL, e.g. https://my-resource.services.ai.azure.com')
  .max(300)
  .transform(normalizeFoundryEndpoint);

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
  apiVersion: apiVersionSchema.default('2024-10-21'),
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

async function readMasked(db: import('@/server/db/tenant').TenantDb): Promise<MaskedAiProvider> {
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

// Foundry surfaces multiple inference protocols under a single
// resource. Anthropic Claude deployments use the Anthropic Messages
// API at /anthropic/v1/messages (with anthropic-version header and
// x-api-key auth), while every other partner model (OpenAI, DeepSeek,
// Cohere, Mistral, Llama, Phi, …) uses the Azure OpenAI compatibility
// path at /openai/deployments/<name>/chat/completions (with api-key
// auth and ?api-version=… query). We pick by deployment name prefix.
// Source: https://learn.microsoft.com/azure/ai-foundry/foundry-models/how-to/use-foundry-models-claude
// Exported for unit tests; same underscore-prefix-not-applicable
// rationale as normalizeFoundryEndpoint.
export function isClaudeDeployment(deploymentName: string): boolean {
  return /^claude/i.test(deploymentName);
}

// Anthropic API version Foundry currently supports for the Messages
// API. This is the Anthropic protocol version (sent as a header), not
// an Azure REST api-version, so we hardcode it instead of letting
// tenants set it. If/when Foundry exposes a newer one this is the
// single line to update.
const ANTHROPIC_VERSION = '2023-06-01';

// Tiny ping to the configured Azure AI Foundry inference endpoint.
// Validates endpoint + deployment + key all work together. Returns
// plain ok/error so the UI can render a status chip without surfacing
// the raw key.
async function pingAzureAiFoundry(args: {
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
  apiKey: string;
}): Promise<{ ok: true; latencyMs: number } | { ok: false; status: number; error: string }> {
  // Defensive normalisation: rows saved before the schema-level
  // normaliser was added may still hold the project-scoped URL
  // (.../api/projects/<name>), which 404s under both /anthropic and
  // /openai. Collapse to the resource origin so the test works even
  // on dirty rows — the user can then re-save to persist the
  // canonical form.
  const root = normalizeFoundryEndpoint(args.endpoint);
  const claude = isClaudeDeployment(args.deploymentName);
  const url = claude
    ? `${root}/anthropic/v1/messages`
    : `${root}/openai/deployments/${encodeURIComponent(
        args.deploymentName,
      )}/chat/completions?api-version=${encodeURIComponent(args.apiVersion)}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (claude) {
    headers['x-api-key'] = args.apiKey;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  } else {
    headers['api-key'] = args.apiKey;
  }
  // Anthropic puts the model in the body (deployment is not in the
  // URL); OpenAI-compat reads the deployment from the URL path.
  const body = claude
    ? {
        model: args.deploymentName,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }
    : {
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      };
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
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
