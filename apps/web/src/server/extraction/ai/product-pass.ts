// =============================================================
// Stage 2 of map-reduce extraction: per-product pass.
//
// One Foundry call per product manifest entry. Each call returns a
// single ExtractedProduct envelope (not an array).
//
// Failure handling per call:
//   - Truncation on first attempt: ESCALATE the budget (8K → 24K)
//     and retry once. Some products legitimately need more output
//     room (rich rate matrices, dozens of benefits).
//   - Truncation on second attempt: give up on this product. The
//     caller (fan-out) will collect this as a partial failure and
//     surface it as a warning.
//   - Validation failure: one-shot retry with errors fed back.
//   - Retryable transport failure (5xx, 429, network): caller
//     decides whether to throw (BullMQ retry) or skip; we surface
//     `retryable: true` and let the caller pick.
// =============================================================

import type { ExtractedProduct } from '@/server/extraction/heuristic-to-envelope';
import {
  DEFAULT_OUTPUT_TOKENS,
  ESCALATED_OUTPUT_TOKENS,
  type FoundryProvider,
  type FoundryUsage,
  callFoundry,
} from './foundry-client';
import { buildProductUserPrompt } from './prompt-product';
import type { ProductManifestEntry } from './schema-discovery';
import {
  PRODUCT_TOOL_DESCRIPTION,
  PRODUCT_TOOL_NAME,
  formatProductAjvErrors,
  getProductValidator,
  productSchema,
} from './schema-product';

export type ProductPassResult =
  | {
      ok: true;
      product: ExtractedProduct;
      usage: FoundryUsage;
      model: string;
      stopReason: string;
      latencyMs: number;
      retried: boolean;
      escalated: boolean;
    }
  | {
      ok: false;
      retryable: boolean;
      truncated: boolean;
      error: string;
      manifest: ProductManifestEntry;
      usage?: FoundryUsage;
      latencyMs: number;
    };

export type ProductPassInput = {
  provider: FoundryProvider;
  apiKey: string;
  systemPrompt: string;
  workbookText: string;
  manifest: ProductManifestEntry;
  heuristicProduct: ExtractedProduct | null;
};

export async function runProductPass(input: ProductPassInput): Promise<ProductPassResult> {
  const sanitizedSchema = stripSchemaMeta(productSchema as Record<string, unknown>);

  // Attempt 1: default budget.
  const first = await singleAttempt({
    ...input,
    sanitizedSchema,
    retryHint: undefined,
    maxOutputTokens: DEFAULT_OUTPUT_TOKENS,
  });

  if (first.kind === 'ok' && first.validationError == null) {
    return {
      ok: true,
      product: first.product,
      usage: first.usage,
      model: first.model,
      stopReason: first.stopReason,
      latencyMs: first.latencyMs,
      retried: false,
      escalated: false,
    };
  }

  // Attempt 2: escalate budget on truncation, or feed errors back on
  // validation failure. If the first failure was a transport error
  // (retryable network/5xx), surface it — the caller decides whether
  // to retry the whole product or give up.
  if (first.kind === 'fatal' && !first.truncated) {
    return {
      ok: false,
      retryable: first.retryable,
      truncated: false,
      error: first.error,
      manifest: input.manifest,
      latencyMs: first.latencyMs,
      ...(first.usage ? { usage: first.usage } : {}),
    };
  }

  const escalated = first.kind === 'fatal' && first.truncated;
  const retryHint =
    first.kind === 'ok' && first.validationError ? first.validationError : undefined;

  const second = await singleAttempt({
    ...input,
    sanitizedSchema,
    retryHint,
    maxOutputTokens: escalated ? ESCALATED_OUTPUT_TOKENS : DEFAULT_OUTPUT_TOKENS,
  });

  const cumulativeLatency = first.latencyMs + second.latencyMs;
  const cumulativeUsage = sumUsage(usageOf(first), usageOf(second));

  if (second.kind === 'fatal') {
    return {
      ok: false,
      retryable: second.retryable,
      truncated: second.truncated,
      error: `Product ${input.manifest.productTypeCode}×${input.manifest.insurerCode} retry failed: ${second.error}`,
      manifest: input.manifest,
      usage: cumulativeUsage,
      latencyMs: cumulativeLatency,
    };
  }

  if (second.validationError != null) {
    return {
      ok: false,
      retryable: false,
      truncated: false,
      error: `Product ${input.manifest.productTypeCode}×${input.manifest.insurerCode} failed schema validation twice. Final errors:\n${second.validationError}`,
      manifest: input.manifest,
      usage: cumulativeUsage,
      latencyMs: cumulativeLatency,
    };
  }

  return {
    ok: true,
    product: second.product,
    usage: cumulativeUsage,
    model: second.model,
    stopReason: second.stopReason,
    latencyMs: cumulativeLatency,
    retried: true,
    escalated,
  };
}

type SingleAttempt =
  | {
      kind: 'ok';
      product: ExtractedProduct;
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
  manifest: ProductManifestEntry;
  heuristicProduct: ExtractedProduct | null;
  sanitizedSchema: Record<string, unknown>;
  retryHint: string | undefined;
  maxOutputTokens: number;
}): Promise<SingleAttempt> {
  const userPrompt = buildProductUserPrompt(
    args.workbookText,
    args.manifest,
    args.heuristicProduct,
    args.retryHint,
  );
  const result = await callFoundry(args.provider, args.apiKey, {
    system: args.systemPrompt,
    user: userPrompt,
    tool: {
      name: PRODUCT_TOOL_NAME,
      description: PRODUCT_TOOL_DESCRIPTION,
      inputSchema: args.sanitizedSchema,
    },
    maxOutputTokens: args.maxOutputTokens,
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

  const validator = getProductValidator();
  const valid = validator(result.output);
  if (!valid) {
    return {
      kind: 'ok',
      product: result.output as ExtractedProduct,
      validationError: formatProductAjvErrors(validator.errors),
      usage: result.usage,
      model: result.model,
      stopReason: result.stopReason,
      latencyMs: result.latencyMs,
    };
  }

  return {
    kind: 'ok',
    product: result.output as ExtractedProduct,
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

function usageOf(a: SingleAttempt): FoundryUsage {
  if (a.kind === 'ok') return a.usage;
  return (
    a.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    }
  );
}

function sumUsage(a: FoundryUsage, b: FoundryUsage): FoundryUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}
