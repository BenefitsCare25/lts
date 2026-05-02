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
//
// Truncation policy (industry-standard fail-fast):
//   - Anthropic returns stop_reason="max_tokens" when generation
//     hits the max_tokens cap mid-tool_use. The tool_use input that
//     comes back is a partial / empty object — useless.
//   - OpenAI-compat returns finish_reason="length" in the same case.
//   - We DO NOT silently forward this as ok:true. Instead we return
//     ok:false with truncated:true so the caller can either escalate
//     the budget (single product retry with larger cap) or split the
//     request further (run more passes). Retrying with identical
//     inputs guarantees identical truncation, which is what burned us
//     in the v1 monolithic design.
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

// Conservative request timeout for standard passes (8K output budget).
const REQUEST_TIMEOUT_MS = 120_000;
// Extended timeout for escalated passes (24K output budget). Opus
// generating 24K tokens over a large context can take 3-4 minutes;
// the standard 120s budget causes GHS and WICI to fail consistently.
export const ESCALATED_REQUEST_TIMEOUT_MS = 240_000;

// Default per-call output budget. The new map-reduce architecture
// keeps each call's output small (1 product envelope ≈ 2-4K tokens,
// discovery manifest ≈ 3-5K tokens) so 8K is comfortable headroom.
// Callers escalate to ESCALATED_OUTPUT_TOKENS when a per-product call
// truncates — gives the model 3x runway for unusually rich products.
export const DEFAULT_OUTPUT_TOKENS = 8_000;
export const ESCALATED_OUTPUT_TOKENS = 24_000;

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
  // Override the default REQUEST_TIMEOUT_MS. Pass ESCALATED_REQUEST_TIMEOUT_MS
  // when maxOutputTokens is set to ESCALATED_OUTPUT_TOKENS.
  timeoutMs?: number;
};

export type FoundryUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export const emptyUsage = (): FoundryUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
});

export const addUsage = (a: FoundryUsage, b: FoundryUsage): FoundryUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
});

// Anthropic rejects schemas containing $schema / $id keys at the
// tool-input boundary (OpenAI's strict mode also chokes on some
// draft-7 idioms with these present). Strip them; the runner-side
// Ajv still validates the full schema.
export function stripSchemaMeta(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, $id: _id, ...rest } = schema;
  return rest;
}

export type FoundryCallResult =
  | {
      ok: true;
      output: Record<string, unknown>;
      // The model's own stop_reason / finish_reason. Always non-null
      // on success — `end_turn` (Anthropic) or `stop`/`tool_calls`
      // (OpenAI). Logged for observability.
      stopReason: string;
      usage: FoundryUsage;
      model: string;
      latencyMs: number;
    }
  | {
      ok: false;
      // True when the model hit max_tokens mid-generation. The
      // tool_use input on the wire is partial/empty; never usable.
      // Distinct from `retryable` because retrying with identical
      // inputs always re-truncates. The caller decides whether to
      // escalate the budget or split the request.
      truncated: boolean;
      // True for transient failures (5xx, 429, network). False for
      // permanent failures (auth, schema sanitization, model refused
      // to call the tool, response was not JSON).
      retryable: boolean;
      error: string;
      status?: number;
      latencyMs: number;
      // Best-effort usage telemetry on failure. Not all failure paths
      // populate this (e.g. network errors have no body).
      usage?: FoundryUsage;
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

// Best-effort model family detection from the deployment name. Used
// by the runner to pick safe per-call max_tokens caps and to surface
// which model handled a given call in telemetry. Returning 'unknown'
// is fine — the runner falls back to conservative defaults.
export type ModelFamily = 'claude-opus' | 'claude-sonnet' | 'claude-haiku' | 'gpt' | 'unknown';

export function detectModelFamily(deploymentName: string): ModelFamily {
  const lower = deploymentName.toLowerCase();
  if (lower.includes('opus')) return 'claude-opus';
  if (lower.includes('sonnet')) return 'claude-sonnet';
  if (lower.includes('haiku')) return 'claude-haiku';
  if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')) return 'gpt';
  return 'unknown';
}

// Hard upper bound for max_tokens per family. The runner clamps
// caller-requested budgets to these to avoid 400 responses from
// models that don't support large outputs.
export function maxOutputCapFor(family: ModelFamily): number {
  switch (family) {
    case 'claude-opus':
      return 32_000;
    case 'claude-sonnet':
      return 64_000;
    case 'claude-haiku':
      return 8_192;
    case 'gpt':
      return 16_384;
    case 'unknown':
      return 16_000;
  }
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

  // Clamp the requested budget to the model family's hard cap. The
  // caller gets back a truncated:true result (not a 400) when the
  // model's own ceiling is the constraint.
  const family = detectModelFamily(provider.deploymentName);
  const requested = params.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS;
  const clamped = Math.min(requested, maxOutputCapFor(family));
  const callParams: FoundryCallParams = { ...params, maxOutputTokens: clamped };

  const body = claude
    ? buildAnthropicBody(provider.deploymentName, callParams)
    : buildOpenAiBody(callParams);

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(params.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      truncated: false,
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
      truncated: false,
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
      truncated: false,
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
  // tenant in a session pay ~10% of the input cost. Workbook text
  // also gets cache_control because the same workbook is reused
  // across the discovery pass and N per-product passes — caching the
  // serialized workbook saves ~90% of input tokens on calls 2..N.
  return {
    model,
    max_tokens: params.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS,
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
        content: [
          {
            type: 'text',
            text: params.user,
            cache_control: { type: 'ephemeral' },
          },
        ],
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
  const stopReason = r.stop_reason ?? 'unknown';
  const usage: FoundryUsage = {
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: r.usage?.cache_creation_input_tokens ?? 0,
  };

  // Truncation: model hit max_tokens before completing the tool_use
  // input. The partial input is unsafe to forward — return ok:false
  // with truncated:true so the caller can escalate or split.
  if (stopReason === 'max_tokens') {
    return {
      ok: false,
      truncated: true,
      retryable: false,
      error: `Output truncated at ${usage.outputTokens} tokens (max_tokens cap). Escalate the per-call budget or split the request.`,
      latencyMs,
      usage,
    };
  }

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
          stopReason,
          model,
          latencyMs,
          usage,
        };
      } catch {
        // fall through
      }
    }
    return {
      ok: false,
      truncated: false,
      retryable: false,
      error: `Model did not invoke the ${expectedToolName} tool. stop_reason=${stopReason}`,
      latencyMs,
      usage,
    };
  }
  return {
    ok: true,
    output: toolBlock.input,
    stopReason,
    model,
    latencyMs,
    usage,
  };
}

// ─────────────────────────────────────────────────────────────
// Azure OpenAI compatibility endpoint
// ─────────────────────────────────────────────────────────────

function buildOpenAiBody(params: FoundryCallParams): Record<string, unknown> {
  return {
    max_tokens: params.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS,
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
  const finishReason = choice?.finish_reason ?? 'unknown';
  const usage: FoundryUsage = {
    inputTokens: r.usage?.prompt_tokens ?? 0,
    outputTokens: r.usage?.completion_tokens ?? 0,
    cacheReadTokens: r.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cacheCreationTokens: 0,
  };

  // Truncation on OpenAI-compat: finish_reason === 'length' means
  // generation hit max_tokens. Mirror the Anthropic behaviour.
  if (finishReason === 'length') {
    return {
      ok: false,
      truncated: true,
      retryable: false,
      error: `Output truncated at ${usage.outputTokens} tokens (max_tokens cap). Escalate the per-call budget or split the request.`,
      latencyMs,
      usage,
    };
  }

  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    return {
      ok: false,
      truncated: false,
      retryable: false,
      error: `Model did not call the function. finish_reason=${finishReason}`,
      latencyMs,
      usage,
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      truncated: false,
      retryable: false,
      error: `Tool arguments were not valid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
      latencyMs,
      usage,
    };
  }
  return {
    ok: true,
    output: parsed,
    stopReason: finishReason,
    model,
    latencyMs,
    usage,
  };
}
