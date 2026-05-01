// =============================================================
// Stage 1 of map-reduce extraction: discovery pass.
//
// One Foundry call. Output: a product manifest (which (productType,
// insurer) tuples are present) + cross-cutting metadata (client,
// entities, benefit year, insurers, pool). NO per-product field
// values — that is Stage 2.
//
// Failure handling:
//   - Truncation: caller bails (the whole extraction is doomed —
//     can't extract products without knowing what products exist).
//   - Retryable: caller throws so BullMQ retries the job.
//   - Validation failure: one-shot retry with errors fed back. Same
//     pattern as the v1 retry, but on a much smaller payload, so the
//     retry is unlikely to truncate.
// =============================================================

import type { ExtractedProduct } from '@/server/extraction/heuristic-to-envelope';
import {
  DEFAULT_OUTPUT_TOKENS,
  type FoundryProvider,
  type FoundryUsage,
  callFoundry,
} from './foundry-client';
import { buildDiscoveryUserPrompt } from './prompt-discovery';
import {
  DISCOVERY_TOOL_DESCRIPTION,
  DISCOVERY_TOOL_NAME,
  type DiscoveryOutput,
  discoveryOutputSchema,
  formatDiscoveryAjvErrors,
  getDiscoveryValidator,
} from './schema-discovery';

export type DiscoveryPassResult =
  | {
      ok: true;
      output: DiscoveryOutput;
      usage: FoundryUsage;
      model: string;
      stopReason: string;
      latencyMs: number;
      retried: boolean;
    }
  | {
      ok: false;
      retryable: boolean;
      truncated: boolean;
      error: string;
      usage?: FoundryUsage;
      latencyMs: number;
    };

export type DiscoveryPassInput = {
  provider: FoundryProvider;
  apiKey: string;
  systemPrompt: string;
  workbookText: string;
  heuristicProducts: ExtractedProduct[];
};

export async function runDiscoveryPass(input: DiscoveryPassInput): Promise<DiscoveryPassResult> {
  const sanitizedSchema = stripSchemaMeta(discoveryOutputSchema as Record<string, unknown>);

  const first = await singleAttempt({
    ...input,
    sanitizedSchema,
    retryHint: undefined,
  });
  if (first.kind === 'fatal') {
    return {
      ok: false,
      retryable: first.retryable,
      truncated: first.truncated,
      error: first.error,
      latencyMs: first.latencyMs,
      ...(first.usage ? { usage: first.usage } : {}),
    };
  }

  if (first.validationError == null) {
    return {
      ok: true,
      output: first.output,
      usage: first.usage,
      model: first.model,
      stopReason: first.stopReason,
      latencyMs: first.latencyMs,
      retried: false,
    };
  }

  // One-shot retry feeding the validation errors back.
  const second = await singleAttempt({
    ...input,
    sanitizedSchema,
    retryHint: first.validationError,
  });
  if (second.kind === 'fatal') {
    return {
      ok: false,
      retryable: second.retryable,
      truncated: second.truncated,
      error: `Discovery retry failed: ${second.error}`,
      latencyMs: first.latencyMs + second.latencyMs,
      ...(second.usage ? { usage: second.usage } : {}),
    };
  }

  if (second.validationError != null) {
    return {
      ok: false,
      retryable: false,
      truncated: false,
      error: `Discovery output failed schema validation twice. Final errors:\n${second.validationError}`,
      latencyMs: first.latencyMs + second.latencyMs,
      usage: sumUsage(first.usage, second.usage),
    };
  }

  return {
    ok: true,
    output: second.output,
    usage: sumUsage(first.usage, second.usage),
    model: second.model,
    stopReason: second.stopReason,
    latencyMs: first.latencyMs + second.latencyMs,
    retried: true,
  };
}

type SingleAttempt =
  | {
      kind: 'ok';
      output: DiscoveryOutput;
      validationError: string | null;
      usage: FoundryUsage;
      model: string;
      stopReason: string;
      latencyMs: number;
    }
  | {
      kind: 'fatal';
      error: string;
      retryable: boolean;
      truncated: boolean;
      latencyMs: number;
      usage?: FoundryUsage;
    };

async function singleAttempt(args: {
  provider: FoundryProvider;
  apiKey: string;
  systemPrompt: string;
  workbookText: string;
  heuristicProducts: ExtractedProduct[];
  sanitizedSchema: Record<string, unknown>;
  retryHint: string | undefined;
}): Promise<SingleAttempt> {
  const userPrompt = buildDiscoveryUserPrompt(
    args.workbookText,
    args.heuristicProducts,
    args.retryHint,
  );
  const result = await callFoundry(args.provider, args.apiKey, {
    system: args.systemPrompt,
    user: userPrompt,
    tool: {
      name: DISCOVERY_TOOL_NAME,
      description: DISCOVERY_TOOL_DESCRIPTION,
      inputSchema: args.sanitizedSchema,
    },
    maxOutputTokens: DEFAULT_OUTPUT_TOKENS,
  });

  if (!result.ok) {
    return {
      kind: 'fatal',
      error: result.error,
      retryable: result.retryable,
      truncated: result.truncated,
      latencyMs: result.latencyMs,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  }

  const validator = getDiscoveryValidator();
  const valid = validator(result.output);
  if (!valid) {
    return {
      kind: 'ok',
      output: result.output as DiscoveryOutput,
      validationError: formatDiscoveryAjvErrors(validator.errors),
      usage: result.usage,
      model: result.model,
      stopReason: result.stopReason,
      latencyMs: result.latencyMs,
    };
  }

  return {
    kind: 'ok',
    output: result.output as DiscoveryOutput,
    validationError: null,
    usage: result.usage,
    model: result.model,
    stopReason: result.stopReason,
    latencyMs: result.latencyMs,
  };
}

function stripSchemaMeta(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema, $id, ...rest } = schema;
  void $schema;
  void $id;
  return rest;
}

function sumUsage(a: FoundryUsage, b: FoundryUsage): FoundryUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}
