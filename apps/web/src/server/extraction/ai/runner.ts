// =============================================================
// AI extraction runner — the orchestrator that ties the AI module
// pieces together. Owns the prompt assembly, the Foundry call, the
// validate-and-retry loop, and the merge-with-heuristic step.
//
// The runner is invoked from the BullMQ extraction job. It returns
// a structured result the job persists onto ExtractionDraft.
//
// Failure modes are explicit and serializable (ok: false, error,
// retryable). The job uses `retryable` to decide whether to throw
// (which BullMQ retries) or to mark the draft FAILED (which it does
// not retry). Validation failures after the one-shot retry are not
// retryable — the model's output is structurally wrong and another
// attempt with the same inputs won't help.
// =============================================================

import type { TenantDb } from '@/server/db/tenant';
import type {
  ExtractedProduct,
  FieldEnvelope,
  SourceRef,
} from '@/server/extraction/heuristic-to-envelope';
import { isClaudeDeployment } from '@/server/trpc/routers/tenant-ai-provider';
import { type CatalogueContext, loadCatalogueContext } from './catalogue-context';
import {
  type FoundryProvider,
  callFoundry,
  decryptProviderKey,
  loadActiveProvider,
} from './foundry-client';
import {
  type AiOutput,
  type AiOutputBenefitYear,
  type AiOutputInsurer,
  type AiOutputPolicyEntity,
  type AiOutputPool,
  type AiOutputProposedClient,
  formatAjvErrors,
  getOutputValidator,
} from './output-schema';
import { aiOutputSchema } from './output-schema';
import {
  EXTRACTION_TOOL_DESCRIPTION,
  EXTRACTION_TOOL_NAME,
  buildSystemPrompt,
  buildUserPrompt,
} from './prompt';
import { type WorkbookText, flattenWorkbookText, workbookToText } from './workbook-to-text';

export const AI_EXTRACTOR_VERSION = 'ai-foundry-1.0';

export type AiRunnerSuccess = {
  ok: true;
  // Per-product extractions, merged with the heuristic floor.
  products: ExtractedProduct[];
  // Wizard-section proposals.
  proposedClient: AiOutputProposedClient;
  proposedPolicyEntities: AiOutputPolicyEntity[];
  proposedBenefitYear: AiOutputBenefitYear;
  proposedInsurers: AiOutputInsurer[];
  proposedPool: AiOutputPool;
  // Combined warnings: workbook serializer truncation notes plus
  // model-emitted warnings.
  warnings: string[];
  // Telemetry.
  meta: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    latencyMs: number;
    workbookChars: number;
    workbookTruncated: boolean;
    sheetsCount: number;
    retried: boolean;
  };
};

export type AiRunnerFailure = {
  ok: false;
  retryable: boolean;
  error: string;
  // Diagnostics (best-effort — may be empty on early failures).
  meta: {
    workbookChars?: number;
    sheetsCount?: number;
    latencyMs?: number;
  };
};

export type AiRunnerResult = AiRunnerSuccess | AiRunnerFailure;

export type RunAiExtractionInput = {
  db: TenantDb;
  tenantSlug: string;
  workbookBuffer: Buffer;
  // The heuristic baseline. Empty array when no template matched.
  // Used as the floor — confidence-1.0 cells survive the merge.
  heuristicProducts: ExtractedProduct[];
};

export async function runAiExtraction(input: RunAiExtractionInput): Promise<AiRunnerResult> {
  const { db, tenantSlug, workbookBuffer, heuristicProducts } = input;

  const provider = await loadActiveProvider(db);
  if (!provider) {
    return {
      ok: false,
      retryable: false,
      error:
        'No active AI provider configured for this tenant. Configure one at /admin/settings/ai-provider before running extraction.',
      meta: {},
    };
  }

  // biome-ignore lint/suspicious/noConsoleLog: intentional lifecycle log
  console.log(
    `[ai-extraction] provider deployment=${provider.deploymentName} protocol=${isClaudeDeployment(provider.deploymentName) ? 'anthropic' : 'openai-compat'} endpoint=${provider.endpoint}`,
  );

  let workbookText: WorkbookText;
  try {
    workbookText = await workbookToText(workbookBuffer);
  } catch (err) {
    return {
      ok: false,
      retryable: false,
      error: `Workbook could not be serialized: ${err instanceof Error ? err.message : 'unknown error'}`,
      meta: {},
    };
  }

  // biome-ignore lint/suspicious/noConsoleLog: intentional lifecycle log
  console.log(
    `[ai-extraction] workbook sheets=${workbookText.sheets.length} chars=${workbookText.totalChars} truncated=${workbookText.truncated}`,
  );

  if (workbookText.sheets.length === 0) {
    return {
      ok: false,
      retryable: false,
      error: 'Workbook has no sheets to extract from.',
      meta: { workbookChars: 0, sheetsCount: 0 },
    };
  }

  const catalogue = await loadCatalogueContext(db, tenantSlug);
  const systemPrompt = buildSystemPrompt(catalogue);
  const flattened = flattenWorkbookText(workbookText);

  const apiKey = (() => {
    try {
      return decryptProviderKey(provider);
    } catch {
      return null;
    }
  })();
  if (!apiKey) {
    return {
      ok: false,
      retryable: false,
      error:
        'Stored AI provider key could not be decrypted. APP_SECRET_KEY may have changed since it was saved. Re-enter the API key at /admin/settings/ai-provider.',
      meta: {},
    };
  }

  const firstAttempt = await callOnce({
    provider,
    apiKey,
    systemPrompt,
    workbookText: flattened,
    retryHint: undefined,
  });
  if (firstAttempt.kind === 'fatal') {
    return {
      ok: false,
      retryable: firstAttempt.retryable,
      error: firstAttempt.error,
      meta: {
        workbookChars: workbookText.totalChars,
        sheetsCount: workbookText.sheets.length,
        ...(firstAttempt.latencyMs != null ? { latencyMs: firstAttempt.latencyMs } : {}),
      },
    };
  }

  let validatedOutput: AiOutput | null = null;
  let retried = false;
  let totalLatency = firstAttempt.latencyMs;
  let totalInputTokens = firstAttempt.usage.inputTokens;
  let totalOutputTokens = firstAttempt.usage.outputTokens;
  let totalCacheReadTokens = firstAttempt.usage.cacheReadTokens;
  let totalCacheCreationTokens = firstAttempt.usage.cacheCreationTokens;
  let model = firstAttempt.model;

  if (firstAttempt.validationError == null) {
    validatedOutput = firstAttempt.output as AiOutput;
  } else {
    // One-shot retry with the validation errors fed back. The model
    // is generally good at re-emitting a corrected version when told
    // exactly what failed.
    retried = true;
    const retryAttempt = await callOnce({
      provider,
      apiKey,
      systemPrompt,
      workbookText: flattened,
      retryHint: firstAttempt.validationError,
    });
    if (retryAttempt.kind === 'fatal') {
      return {
        ok: false,
        retryable: retryAttempt.retryable,
        error: `Retry failed: ${retryAttempt.error}`,
        meta: {
          workbookChars: workbookText.totalChars,
          sheetsCount: workbookText.sheets.length,
          latencyMs: totalLatency + (retryAttempt.latencyMs ?? 0),
        },
      };
    }
    totalLatency += retryAttempt.latencyMs;
    totalInputTokens += retryAttempt.usage.inputTokens;
    totalOutputTokens += retryAttempt.usage.outputTokens;
    totalCacheReadTokens += retryAttempt.usage.cacheReadTokens;
    totalCacheCreationTokens += retryAttempt.usage.cacheCreationTokens;
    model = retryAttempt.model;
    if (retryAttempt.validationError != null) {
      return {
        ok: false,
        retryable: false,
        error: `Model output failed schema validation twice. Final errors:\n${retryAttempt.validationError}`,
        meta: {
          workbookChars: workbookText.totalChars,
          sheetsCount: workbookText.sheets.length,
          latencyMs: totalLatency,
        },
      };
    }
    validatedOutput = retryAttempt.output as AiOutput;
  }

  // Merge AI products with the heuristic floor. Confidence-1.0 cells
  // from the heuristic are preserved; AI fills nulls and lifts low-
  // confidence cells.
  const merged = mergeProducts(heuristicProducts, validatedOutput.products as ExtractedProduct[]);

  const combinedWarnings = [...workbookText.warnings, ...validatedOutput.warnings];

  return {
    ok: true,
    products: merged,
    proposedClient: validatedOutput.proposedClient,
    proposedPolicyEntities: validatedOutput.proposedPolicyEntities,
    proposedBenefitYear: validatedOutput.proposedBenefitYear,
    proposedInsurers: validatedOutput.proposedInsurers,
    proposedPool: validatedOutput.proposedPool,
    warnings: combinedWarnings,
    meta: {
      model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheReadTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      latencyMs: totalLatency,
      workbookChars: workbookText.totalChars,
      workbookTruncated: workbookText.truncated,
      sheetsCount: workbookText.sheets.length,
      retried,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────

type SingleAttemptResult =
  | {
      kind: 'ok';
      output: Record<string, unknown>;
      validationError: string | null;
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
      kind: 'fatal';
      error: string;
      retryable: boolean;
      latencyMs: number | null;
    };

async function callOnce(args: {
  provider: FoundryProvider;
  apiKey: string;
  systemPrompt: string;
  workbookText: string;
  retryHint: string | undefined;
}): Promise<SingleAttemptResult> {
  const userPrompt = buildUserPrompt(args.workbookText, args.retryHint);
  const result = await callFoundry(args.provider, args.apiKey, {
    system: args.systemPrompt,
    user: userPrompt,
    tool: {
      name: EXTRACTION_TOOL_NAME,
      description: EXTRACTION_TOOL_DESCRIPTION,
      // Sanitize for tool-use endpoint — Anthropic rejects schemas
      // that include `$schema` keys, and OpenAI's strict mode rejects
      // `additionalProperties: false` on draft-7 mixed shapes. Strip
      // `$schema`/`$id` and keep the rest. The runner-side Ajv still
      // enforces full validation post-hoc.
      inputSchema: stripSchemaMeta(aiOutputSchema as Record<string, unknown>),
    },
  });
  if (!result.ok) {
    return {
      kind: 'fatal',
      error: result.error,
      retryable: result.retryable,
      latencyMs: result.latencyMs,
    };
  }

  // biome-ignore lint/suspicious/noConsoleLog: intentional lifecycle log
  console.log(
    `[ai-extraction] foundry response model=${result.model} latencyMs=${result.latencyMs} inputTokens=${result.usage.inputTokens} outputTokens=${result.usage.outputTokens} cacheRead=${result.usage.cacheReadTokens}`,
  );

  const validator = getOutputValidator();
  const valid = validator(result.output);
  if (!valid) {
    console.error(
      '[ai-extraction] schema validation failed errors:',
      formatAjvErrors(validator.errors),
    );
    console.error(
      '[ai-extraction] raw output (first 2000 chars):',
      JSON.stringify(result.output).slice(0, 2000),
    );
  }
  return {
    kind: 'ok',
    output: result.output,
    validationError: valid ? null : formatAjvErrors(validator.errors),
    usage: result.usage,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}

function stripSchemaMeta(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema, $id, ...rest } = schema;
  void $schema;
  void $id;
  return rest;
}

// ─────────────────────────────────────────────────────────────
// Heuristic-AI merge
// ─────────────────────────────────────────────────────────────

// Merge rule: AI is additive. Heuristic confidence-1.0 leaves win;
// AI fills null/0-confidence leaves and may lift mid-confidence ones.
// Products the heuristic produced that the AI didn't are preserved
// as-is. Products the AI produced that the heuristic didn't are
// added unchanged. When both produce the same (productTypeCode,
// insurerCode) pair, they merge field-by-field.
export function mergeProducts(
  heuristic: ExtractedProduct[],
  ai: ExtractedProduct[],
): ExtractedProduct[] {
  const keyOf = (p: ExtractedProduct) => `${p.productTypeCode}::${p.insurerCode}`;
  const aiByKey = new Map<string, ExtractedProduct>();
  for (const p of ai) aiByKey.set(keyOf(p), p);

  const merged: ExtractedProduct[] = [];
  const seenKeys = new Set<string>();

  for (const h of heuristic) {
    const k = keyOf(h);
    seenKeys.add(k);
    const a = aiByKey.get(k);
    if (!a) {
      merged.push(h);
      continue;
    }
    merged.push(mergeOneProduct(h, a));
  }
  for (const a of ai) {
    if (!seenKeys.has(keyOf(a))) merged.push(a);
  }
  return merged;
}

function mergeOneProduct(h: ExtractedProduct, a: ExtractedProduct): ExtractedProduct {
  return {
    productTypeCode: h.productTypeCode,
    insurerCode: h.insurerCode,
    header: {
      policyNumber: pickEnvelope(h.header.policyNumber, a.header.policyNumber),
      period: pickEnvelope(h.header.period, a.header.period),
      lastEntryAge: pickEnvelope(h.header.lastEntryAge, a.header.lastEntryAge),
      administrationType: pickEnvelope(h.header.administrationType, a.header.administrationType),
      currency: pickEnvelope(h.header.currency, a.header.currency),
    },
    policyholder: {
      legalName: pickEnvelope(h.policyholder.legalName, a.policyholder.legalName),
      uen: pickEnvelope(h.policyholder.uen, a.policyholder.uen),
      address: pickEnvelope(h.policyholder.address, a.policyholder.address),
      businessDescription: pickEnvelope(
        h.policyholder.businessDescription,
        a.policyholder.businessDescription,
      ),
      // Policy entities: heuristic is workbook-level (parsed from a
      // Schedule of Insured Persons block); AI may discover entities
      // the parser missed. Concatenate with de-dupe on legalName +
      // policyNumber.
      insuredEntities: dedupePolicyEntities([
        ...h.policyholder.insuredEntities,
        ...a.policyholder.insuredEntities,
      ]),
    },
    eligibility: {
      freeText: pickEnvelope(h.eligibility.freeText, a.eligibility.freeText),
      // Categories: heuristic emits one per plan label; AI may emit
      // richer SI formulae. Prefer AI when it has higher confidence.
      categories:
        a.eligibility.categories.length > 0 ? a.eligibility.categories : h.eligibility.categories,
    },
    // Plans / rates / benefits: heuristic is the floor; AI fills gaps
    // and may add plans the heuristic didn't see. Match by raw code.
    plans: mergePlans(h.plans, a.plans),
    premiumRates: mergeRates(h.premiumRates, a.premiumRates),
    benefits: mergeBenefits(h.benefits, a.benefits),
    extractionMeta: {
      overallConfidence: Math.max(
        h.extractionMeta.overallConfidence,
        a.extractionMeta.overallConfidence,
      ),
      extractorVersion: AI_EXTRACTOR_VERSION,
      warnings: [...h.extractionMeta.warnings, ...a.extractionMeta.warnings],
    },
  };
}

// Pick the higher-confidence envelope between heuristic (h) and AI
// (a). Confidence-1.0 from heuristic is always kept. AI wins ties so
// it can lift a 0-confidence empty cell to a non-null value.
function pickEnvelope<T>(h: FieldEnvelope<T>, a: FieldEnvelope<T>): FieldEnvelope<T> {
  if (h.confidence >= 1) return h;
  if (h.value != null && h.confidence >= a.confidence) return h;
  // The AI envelope may carry a sourceRef object that doesn't match
  // the strict shape; coerce its sourceRef into the canonical type
  // (or omit when absent) so exactOptionalPropertyTypes is happy.
  return normalizeEnvelope(a);
}

function normalizeEnvelope<T>(e: FieldEnvelope<T>): FieldEnvelope<T> {
  const out: FieldEnvelope<T> = {
    value: e.value,
    confidence: e.confidence,
  };
  if (e.raw !== undefined) out.raw = e.raw;
  const ref = e.sourceRef as SourceRef | undefined;
  if (ref && (ref.sheet || ref.cell || ref.range)) {
    const cleaned: SourceRef = {};
    if (ref.sheet) cleaned.sheet = ref.sheet;
    if (ref.cell) cleaned.cell = ref.cell;
    if (ref.range) cleaned.range = ref.range;
    out.sourceRef = cleaned;
  }
  return out;
}

function dedupePolicyEntities<
  T extends { legalName: string; policyNumber: string | null; isMaster: boolean },
>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.legalName.trim().toLowerCase()}::${(r.policyNumber ?? '').trim().toLowerCase()}`;
    const existing = seen.get(k);
    if (!existing) {
      seen.set(k, r);
      continue;
    }
    // Keep the master flag if either source set it.
    if (r.isMaster && !existing.isMaster) seen.set(k, r);
  }
  return Array.from(seen.values());
}

function mergePlans<T extends { rawCode: string; confidence: number }>(h: T[], a: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const p of h) byKey.set(p.rawCode, p);
  for (const p of a) {
    const existing = byKey.get(p.rawCode);
    if (!existing || p.confidence > existing.confidence) byKey.set(p.rawCode, p);
  }
  return Array.from(byKey.values());
}

function mergeRates<
  T extends {
    planRawCode: string;
    coverTier: string | null;
    blockLabel?: string | null;
    confidence: number;
  },
>(h: T[], a: T[]): T[] {
  const byKey = new Map<string, T>();
  const k = (r: T) => `${r.planRawCode}::${r.coverTier ?? '_'}::${r.blockLabel ?? '_'}`;
  for (const r of h) byKey.set(k(r), r);
  for (const r of a) {
    const existing = byKey.get(k(r));
    if (!existing || r.confidence > existing.confidence) byKey.set(k(r), r);
  }
  return Array.from(byKey.values());
}

function mergeBenefits<T extends { rawName: string; confidence: number }>(h: T[], a: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const b of h) byKey.set(b.rawName.trim().toLowerCase(), b);
  for (const b of a) {
    const k = b.rawName.trim().toLowerCase();
    const existing = byKey.get(k);
    if (!existing || b.confidence > existing.confidence) byKey.set(k, b);
  }
  return Array.from(byKey.values());
}

// Re-export catalogue type — callers (job processor, tRPC mutation)
// occasionally need it for telemetry without re-importing internals.
export type { CatalogueContext };
