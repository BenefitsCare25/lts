// =============================================================
// Tenant-scoped Azure AI Foundry client for the extraction layer.
//
// Lifts the proven Foundry routing logic from the tenant-ai-provider
// router (isClaudeDeployment / URL builder / headers) so we never
// drift on protocol detection. The provider router uses this for its
// `test` ping; the extractor uses it for the real extraction call.
//
// Why raw fetch (not @anthropic-ai/sdk / openai SDK):
//   - Per-tenant credentials live in TenantAiProvider, not env vars.
//   - The two SDKs would each need a separate factory + cache; one
//     fetch path with a routing helper is simpler to reason about.
//   - The same code path tests credentials AND runs extraction —
//     one less thing that can drift.
//
// Two protocol shapes are supported:
//   - Anthropic Messages API (deployment name starts with `claude`)
//   - Azure OpenAI compatibility endpoint (everything else)
//
// Output shape: structured JSON enforced by tool-use (Claude) or
// response_format json_schema (OpenAI-compat). The caller validates
// the JSON against the canonical Ajv schema; this module guarantees
// only that the response is valid JSON of *some* shape.
// =============================================================

import type { TenantDb } from '@/server/db/tenant';
import { decryptSecret } from '@/server/security/secret-cipher';
import {
  isClaudeDeployment,
  normalizeFoundryEndpoint,
} from '@/server/trpc/routers/tenant-ai-provider';

// Anthropic protocol version Foundry currently honours on the
// /anthropic/v1/messages path. This is *not* the Azure REST
// api-version (which only applies to /openai paths) — it's the
// Anthropic SDK's own header. Bump this single line when Foundry
// publishes a newer one.
const ANTHROPIC_VERSION = '2023-06-01';

// Conservative request timeout. Extraction is heavy: a 50-product
// slip can take 60–90s end-to-end. We give the call 5 minutes before
// aborting; the BullMQ job's own timeout sits above this and decides
// whether to retry.
const REQUEST_TIMEOUT_MS = 300_000;

export type FoundryToolSchema = {
  name: string;
  description: string;
  // JSON Schema describing the required output shape. Both Claude
  // and OpenAI-compat engines treat it as the contract.
  inputSchema: Record<string, unknown>;
};

export type FoundryCallParams = {
  // System preamble. Claude wraps this in `system: [...]` blocks
  // with cache_control set so repeat calls within 5 minutes pay 10%
  // of the input cost. OpenAI-compat folds it into messages[0].
  system: string;
  // Single user turn — the workbook text plus the framing prompt.
  user: string;
  // The structured output the model MUST produce.
  tool: FoundryToolSchema;
  // Generation knobs. Defaults tuned for deterministic JSON output.
  maxOutputTokens?: number;
  temperature?: number;
};

export type FoundryCallResult =
  | {
      ok: true;
      output: Record<string, unknown>;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
      };
      model: string;
      latencyMs: number;
    }
  | {
      ok: false;
      retryable: boolean;
      error: string;
      status?: number;
      latencyMs: number;
    };

export type FoundryProvider = {
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
  encryptedKey: string;
};

// Loads the active provider row for the current tenant. Decrypts the
// key into a transient string. Caller is expected to discard the
// plaintext immediately after the request — never persist or log it.
export async function loadActiveProvider(db: TenantDb): Promise<FoundryProvider | null> {
  const row = await db.tenantAiProvider.findFirst({ where: { active: true } });
  if (!row) return null;
  return {
    endpoint: row.endpoint,
    deploymentName: row.deploymentName,
    apiVersion: row.apiVersion,
    encryptedKey: row.encryptedKey,
  };
}

// Decrypts the stored key. Wraps decryptSecret so callers don't have
// to know the column name; centralises the "key only exists in memory
// for the duration of this call" rule.
export function decryptProviderKey(provider: FoundryProvider): string {
  return decryptSecret(provider.encryptedKey);
}

export async function callFoundry(
  provider: FoundryProvider,
  apiKey: string,
  params: FoundryCallParams,
): Promise<FoundryCallResult> {
  const root = normalizeFoundryEndpoint(provider.endpoint);
  const claude = isClaudeDeployment(provider.deploymentName);
  const url = claude
    ? `${root}/anthropic/v1/messages`
    : `${root}/openai/deployments/${encodeURIComponent(
        provider.deploymentName,
      )}/chat/completions?api-version=${encodeURIComponent(provider.apiVersion)}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (claude) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  } else {
    headers['api-key'] = apiKey;
  }

  const body = claude
    ? buildAnthropicBody(provider.deploymentName, params)
    : buildOpenAiBody(params);

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      retryable: true,
      error: err instanceof Error ? err.message : 'Network error',
      latencyMs: Date.now() - started,
    };
  }

  const latencyMs = Date.now() - started;
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const retryable = response.status === 429 || response.status >= 500;
    return {
      ok: false,
      retryable,
      status: response.status,
      error: text.slice(0, 1_000) || `HTTP ${response.status}`,
      latencyMs,
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    return {
      ok: false,
      retryable: false,
      error: `Response was not valid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
      latencyMs,
    };
  }

  return claude
    ? extractFromAnthropic(parsed, provider.deploymentName, latencyMs, params.tool.name)
    : extractFromOpenAi(parsed, provider.deploymentName, latencyMs);
}

// ─────────────────────────────────────────────────────────────
// Anthropic Messages API
// ─────────────────────────────────────────────────────────────

function buildAnthropicBody(model: string, params: FoundryCallParams): Record<string, unknown> {
  // System block uses cache_control so the (large, stable) catalogue
  // preamble caches for 5 minutes — repeat extractions for the same
  // tenant in a session pay ~10% of the input cost.
  return {
    model,
    max_tokens: params.maxOutputTokens ?? 16_000,
    temperature: params.temperature ?? 0,
    system: [
      {
        type: 'text',
        text: params.system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: params.tool.name,
        description: params.tool.description,
        input_schema: params.tool.inputSchema,
      },
    ],
    // Force the model to call our tool — guarantees structured JSON
    // output without the model hedging into a chat reply.
    tool_choice: { type: 'tool', name: params.tool.name },
    messages: [
      {
        role: 'user',
        content: params.user,
      },
    ],
  };
}

type AnthropicResponseShape = {
  content?: Array<
    | { type: 'tool_use'; name: string; input: Record<string, unknown> }
    | { type: 'text'; text: string }
    | { type: string; [k: string]: unknown }
  >;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  stop_reason?: string;
};

function extractFromAnthropic(
  raw: unknown,
  model: string,
  latencyMs: number,
  expectedToolName: string,
): FoundryCallResult {
  const r = raw as AnthropicResponseShape;
  const toolBlock = (r.content ?? []).find(
    (b): b is { type: 'tool_use'; name: string; input: Record<string, unknown> } =>
      b.type === 'tool_use' && b.name === expectedToolName,
  );
  if (!toolBlock) {
    // Fall back: maybe the model emitted JSON in a text block. This
    // is best-effort — production callers should always Ajv-validate
    // the output afterwards.
    const textBlock = (r.content ?? []).find(
      (b): b is { type: 'text'; text: string } => b.type === 'text',
    );
    if (textBlock) {
      const fenced = textBlock.text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      const candidate = fenced?.[1] ?? textBlock.text.trim();
      try {
        const obj = JSON.parse(candidate) as Record<string, unknown>;
        return {
          ok: true,
          output: obj,
          model,
          latencyMs,
          usage: {
            inputTokens: r.usage?.input_tokens ?? 0,
            outputTokens: r.usage?.output_tokens ?? 0,
            cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0,
            cacheCreationTokens: r.usage?.cache_creation_input_tokens ?? 0,
          },
        };
      } catch {
        // fall through
      }
    }
    return {
      ok: false,
      retryable: false,
      error: `Model did not invoke the ${expectedToolName} tool. stop_reason=${r.stop_reason ?? 'unknown'}`,
      latencyMs,
    };
  }
  return {
    ok: true,
    output: toolBlock.input,
    model,
    latencyMs,
    usage: {
      inputTokens: r.usage?.input_tokens ?? 0,
      outputTokens: r.usage?.output_tokens ?? 0,
      cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: r.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Azure OpenAI compatibility endpoint
// ─────────────────────────────────────────────────────────────

function buildOpenAiBody(params: FoundryCallParams): Record<string, unknown> {
  return {
    max_tokens: params.maxOutputTokens ?? 16_000,
    temperature: params.temperature ?? 0,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: params.tool.name,
          description: params.tool.description,
          parameters: params.tool.inputSchema,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: params.tool.name } },
  };
}

type OpenAiResponseShape = {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
      content?: string | null;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

function extractFromOpenAi(raw: unknown, model: string, latencyMs: number): FoundryCallResult {
  const r = raw as OpenAiResponseShape;
  const choice = r.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    return {
      ok: false,
      retryable: false,
      error: `Model did not call the function. finish_reason=${choice?.finish_reason ?? 'unknown'}`,
      latencyMs,
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      retryable: false,
      error: `Tool arguments were not valid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
      latencyMs,
    };
  }
  return {
    ok: true,
    output: parsed,
    model,
    latencyMs,
    usage: {
      inputTokens: r.usage?.prompt_tokens ?? 0,
      outputTokens: r.usage?.completion_tokens ?? 0,
      cacheReadTokens: r.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheCreationTokens: 0,
    },
  };
}
