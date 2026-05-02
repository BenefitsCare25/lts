// =============================================================
// AI extraction runner — map-reduce orchestrator.
//
// Stage 1 (discovery): one Foundry call returns the product manifest
// and cross-cutting metadata.
// Stage 2 (per-product): N Foundry calls in parallel, each returning
// a single ExtractedProduct envelope.
// Stage 3 (merge): combine the heuristic floor with the per-product
// AI output. Heuristic confidence-1.0 cells survive; AI fills gaps.
//
// Failure policy:
//   - Discovery failure (any kind): the whole extraction fails. We
//     can't extract products without knowing what products exist.
//   - Per-product failure: collected as a warning. The runner
//     succeeds as long as at least ONE product extracted cleanly.
//     The wizard surfaces failed products so the broker can re-run
//     the affected slice (future improvement: per-product re-run UI).
//   - Both retryable (5xx, 429, network) and non-retryable failures
//     are reported with the right `retryable` flag so the BullMQ
//     job can decide whether to re-throw or mark FAILED.
//
// Streaming:
//   - The runner accepts an `onProgress` callback. Each pass emits
//     events the job persists onto ExtractionDraft.progress. The
//     wizard's poll picks it up and shows live status.
// =============================================================

import type { TenantDb } from '@/server/db/tenant';
import type { ExtractedProduct, FieldEnvelope, SourceRef } from '../heuristic-to-envelope';
import { type CatalogueContext, loadCatalogueContext } from './catalogue-context';
import { runDiscoveryPass } from './discovery-pass';
import { type ProgressEvent, runProductPasses } from './fan-out';
import {
  type FoundryProvider,
  type FoundryUsage,
  addUsage,
  decryptProviderKey,
  detectModelFamily,
  emptyUsage,
  loadActiveProvider,
} from './foundry-client';
import { buildSharedSystemPrompt } from './prompt-shared';
import type {
  DiscoveryBenefitYear,
  DiscoveryInsurer,
  DiscoveryPolicyEntity,
  DiscoveryPool,
  DiscoveryProposedClient,
  DiscoveryTpa,
  ProductManifestEntry,
} from './schema-discovery';
import {
  type WorkbookText,
  filterWorkbookText,
  flattenWorkbookText,
  workbookToText,
} from './workbook-to-text';

export const AI_EXTRACTOR_VERSION = 'ai-foundry-2.0';

// Re-export the wizard-section types under the legacy AiOutput* names
// so downstream consumers (jobs/extraction.ts) don't need import
// surgery. The shape is identical to the v1 schemas.
export type AiOutputProposedClient = DiscoveryProposedClient;
export type AiOutputPolicyEntity = DiscoveryPolicyEntity;
export type AiOutputBenefitYear = DiscoveryBenefitYear;
export type AiOutputInsurer = DiscoveryInsurer;
export type AiOutputPool = DiscoveryPool;
export type AiOutputTpa = DiscoveryTpa;

export type AiRunnerSuccess = {
  ok: true;
  // Per-product extractions, merged with the heuristic floor.
  products: ExtractedProduct[];
  // Wizard-section proposals from the discovery pass.
  proposedClient: AiOutputProposedClient;
  proposedPolicyEntities: AiOutputPolicyEntity[];
  proposedBenefitYear: AiOutputBenefitYear;
  proposedInsurers: AiOutputInsurer[];
  proposedPool: AiOutputPool;
  proposedTpa: AiOutputTpa;
  // Warnings from: serializer truncation + discovery pass + each
  // per-product pass + per-product failures (partial-success path).
  warnings: string[];
  // Telemetry. The runner sums tokens across all passes (discovery +
  // every product pass).
  meta: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    latencyMs: number; // wall time
    workbookChars: number;
    workbookTruncated: boolean;
    sheetsCount: number;
    retried: boolean; // true if discovery or any product pass retried
    productsRequested: number; // discovery manifest length
    productsExtracted: number; // successful product passes
    productsFailed: number; // failed product passes (kept as warnings)
  };
};

export type AiRunnerFailure = {
  ok: false;
  retryable: boolean;
  error: string;
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
  heuristicProducts: ExtractedProduct[];
  // Optional progress sink — the job uses this to stream events into
  // ExtractionDraft.progress so the wizard's poll sees live status.
  onProgress?: RunnerProgressHandler;
};

export type RunnerProgressHandler = (event: RunnerProgressEvent) => Promise<void> | void;

export type RunnerProgressEvent =
  | { kind: 'discovery_started' }
  | {
      kind: 'discovery_done';
      // Full manifest of (productType, insurer) keys in the order they
      // came back from discovery. The job persists this so the wizard
      // can render a per-product progress list.
      productKeys: string[];
      latencyMs: number;
      retried: boolean;
    }
  | { kind: 'product_started'; productKey: string; total: number }
  | {
      kind: 'product_done';
      productKey: string;
      index: number;
      total: number;
      ok: boolean;
      error?: string;
      truncated?: boolean;
      latencyMs: number;
    };

export async function runAiExtraction(input: RunAiExtractionInput): Promise<AiRunnerResult> {
  const { db, tenantSlug, workbookBuffer, heuristicProducts, onProgress } = input;
  const wallStart = Date.now();

  // Provider, workbook serialization, and catalogue context are
  // independent. Run them concurrently — workbookToText on a 25 MB
  // buffer can take 1-3s on its own, the other two are short DB hops.
  const [provider, workbookResult, catalogue] = await Promise.all([
    loadActiveProvider(db),
    serializeWorkbookSafely(workbookBuffer),
    loadCatalogueContext(db, tenantSlug),
  ]);

  if (!provider) {
    return {
      ok: false,
      retryable: false,
      error:
        'No active AI provider configured for this tenant. Configure one at /admin/settings/ai-provider before running extraction.',
      meta: {},
    };
  }
  if (!workbookResult.ok) {
    return { ok: false, retryable: false, error: workbookResult.error, meta: {} };
  }
  const workbookText = workbookResult.text;

  const family = detectModelFamily(provider.deploymentName);
  // biome-ignore lint/suspicious/noConsoleLog: intentional lifecycle log
  console.log(
    `[ai-extraction] provider deployment=${provider.deploymentName} family=${family} endpoint=${provider.endpoint}`,
  );
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

  const systemPrompt = buildSharedSystemPrompt(catalogue);
  const flattened = flattenWorkbookText(workbookText);

  // ───── Stage 1: discovery ─────
  await safeProgress(onProgress, { kind: 'discovery_started' });
  // biome-ignore lint/suspicious/noConsoleLog: intentional lifecycle log
  console.log('[ai-extraction] discovery pass starting');

  const discovery = await runDiscoveryPass({
    provider,
    apiKey,
    systemPrompt,
    workbookText: flattened,
    heuristicProducts,
  });

  if (!discovery.ok) {
    console.error(
      `[ai-extraction] discovery failed retryable=${discovery.retryable} truncated=${discovery.truncated} error=${discovery.error}`,
    );
    return {
      ok: false,
      retryable: discovery.retryable,
      error: discovery.error,
      meta: {
        workbookChars: workbookText.totalChars,
        sheetsCount: workbookText.sheets.length,
        latencyMs: discovery.latencyMs,
      },
    };
  }

  // biome-ignore lint/suspicious/noConsoleLog: intentional lifecycle log
  console.log(
    `[ai-extraction] discovery done products=${discovery.output.productManifest.length} latencyMs=${discovery.latencyMs} retried=${discovery.retried}`,
  );

  // Empty manifest. The discovery model said there are no products
  // here. Treat as success-with-zero-products (the broker may have
  // uploaded a non-slip workbook or a cover page only).
  if (discovery.output.productManifest.length === 0) {
    await safeProgress(onProgress, {
      kind: 'discovery_done',
      productKeys: [],
      latencyMs: discovery.latencyMs,
      retried: discovery.retried,
    });
    return {
      ok: true,
      products: heuristicProducts,
      proposedClient: discovery.output.proposedClient,
      proposedPolicyEntities: discovery.output.proposedPolicyEntities,
      proposedBenefitYear: discovery.output.proposedBenefitYear,
      proposedInsurers: discovery.output.proposedInsurers,
      proposedPool: discovery.output.proposedPool,
      proposedTpa: discovery.output.proposedTpa ?? null,
      warnings: [
        ...workbookText.warnings,
        ...discovery.output.warnings,
        'Discovery pass found no extractable products. Heuristic baseline returned as-is.',
      ],
      meta: buildMetaForZeroProducts({
        workbookText,
        wallStart,
        provider,
        family,
        discoveryUsage: discovery.usage,
        discoveryRetried: discovery.retried,
        model: discovery.model,
      }),
    };
  }

  // ───── Insurer-code canonicalisation ─────
  // Heuristic codes come from ProductType.parsingRules keys (often a
  // legacy short form like `GE`, `CI`, `ZI`); discovery codes come from
  // the AI which prefers the catalogue's official Insurer.code (e.g.
  // `GE_LIFE`, `CHUBB`, `ZURICH`). Without aliasing, the heuristic and
  // AI products never merge — `mergeProducts` keys on `productTypeCode::
  // insurerCode` so `GTL::GE` and `GTL::GE_LIFE` survive as duplicates.
  // We resolve both sides to a single canonical code BEFORE fan-out so
  // every downstream stage (fan-out, merge, suggestions, apply) sees one
  // entry per real product.
  const insurerAlias = buildInsurerAliasMap({
    heuristicCodes: Array.from(new Set(heuristicProducts.map((h) => h.insurerCode))),
    proposedInsurers: discovery.output.proposedInsurers,
    catalogueInsurers: catalogue.insurers,
  });
  const canonicalisedHeuristic = applyInsurerAliasToProducts(heuristicProducts, insurerAlias);
  const canonicalisedManifest = discovery.output.productManifest.map((m) => ({
    ...m,
    insurerCode: insurerAlias.get(m.insurerCode) ?? m.insurerCode,
  }));

  // Emit canonicalised keys so the wizard's per-product list keys
  // match the productKeys used by subsequent product_started/done
  // events. Emitting raw discovery keys here would leave the list
  // permanently stuck on "queued" while completedCount increments.
  await safeProgress(onProgress, {
    kind: 'discovery_done',
    productKeys: canonicalisedManifest.map((m) => productKey(m)),
    latencyMs: discovery.latencyMs,
    retried: discovery.retried,
  });

  // ───── Stage 2: per-product fan-out ─────
  const heuristicByKey = indexHeuristic(canonicalisedHeuristic);
  const total = canonicalisedManifest.length;
  const manifests = canonicalisedManifest.map((m) => {
    // Filter the workbook to only the sheets this product lives on.
    // Discovery returns anchorSheets per manifest entry; using them
    // cuts per-call input from ~150k chars to ~10-25k chars, reducing
    // generation time enough to avoid timeouts on complex products
    // like GHS (3 sheets) and WICI (1 formula-dense sheet).
    const filteredText =
      m.anchorSheets.length > 0 ? filterWorkbookText(workbookText, m.anchorSheets) : flattened;
    // biome-ignore lint/suspicious/noConsoleLog: intentional lifecycle log
    console.log(
      `[ai-extraction] manifest ${productKey(m)} anchorSheets=[${m.anchorSheets.join(',')}] filteredChars=${filteredText.length}`,
    );
    return {
      manifest: m,
      heuristicProduct: heuristicByKey.get(productKey(m)) ?? null,
      workbookText: filteredText,
    };
  });

  const fanOut = await runProductPasses({
    perCallBase: {
      provider,
      apiKey,
      systemPrompt,
      workbookText: flattened,
    },
    manifests,
    concurrency: 3,
    onProgress: async (event: ProgressEvent) => {
      if (event.kind === 'started') {
        await safeProgress(onProgress, {
          kind: 'product_started',
          productKey: event.productKey,
          total: event.total,
        });
        return;
      }
      const ok = event.result.ok;
      // biome-ignore lint/suspicious/noConsoleLog: intentional lifecycle log
      console.log(
        `[ai-extraction] product ${event.index}/${event.total} ${event.productKey} ${
          ok ? 'ok' : 'failed'
        } latencyMs=${event.result.latencyMs}${
          ok
            ? ''
            : ` truncated=${event.result.truncated} error=${truncate(event.result.error, 200)}`
        }`,
      );
      await safeProgress(onProgress, {
        kind: 'product_done',
        productKey: event.productKey,
        index: event.index,
        total: event.total,
        ok,
        latencyMs: event.result.latencyMs,
        ...(ok ? {} : { error: event.result.error, truncated: event.result.truncated }),
      });
    },
  });

  const productsRequested = total;
  const productsExtracted = fanOut.successes.length;
  const productsFailed = fanOut.failures.length;

  // Partial-success policy: discovery output (client, entities,
  // benefit year, insurers, pool) is surfaced to the wizard as long
  // as discovery itself succeeded — even when every per-product pass
  // failed. The broker keeps the cross-cutting work, the failed
  // products show up as warnings + heuristic-only rows where the
  // parser had a template, and a re-run can target just the misses.

  // ───── Stage 3: merge with heuristic floor ─────
  // AI products inherit the canonical manifest insurerCode via the
  // per-product pass; canonicalisedHeuristic is already aliased.
  // Re-apply the alias defensively in case a per-product pass returned
  // a different code than the manifest told it to (the schema doesn't
  // forbid that today).
  const aiProducts = applyInsurerAliasToProducts(
    fanOut.successes.map((s) => s.product),
    insurerAlias,
  ).map(sanitisePlanRawCodes);
  const merged = mergeProducts(canonicalisedHeuristic, aiProducts)
    .map(sanitisePlanRawCodes)
    .map(fixPerEmployeeFlatRates);
  // Likewise fold the AI's proposed-insurer list onto canonical codes
  // so the wizard's Section 5 doesn't show GE alongside GE_LIFE.
  const canonicalisedProposedInsurers = dedupeProposedInsurers(
    discovery.output.proposedInsurers.map((p) => ({
      ...p,
      code: insurerAlias.get(p.code) ?? p.code,
    })),
  );

  // Aggregate token usage and latency.
  const discoveryUsage = discovery.usage;
  const productUsage = fanOut.successes.reduce<FoundryUsage>((acc, s) => addUsage(acc, s.usage), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });
  const failedProductUsage = fanOut.failures.reduce<FoundryUsage>(
    (acc, f) => addUsage(acc, f.usage ?? emptyUsage()),
    emptyUsage(),
  );
  const totalUsage = addUsage(addUsage(discoveryUsage, productUsage), failedProductUsage);

  const partialFailureWarnings = fanOut.failures.map(
    (f) =>
      `Product ${f.manifest.productTypeCode}×${f.manifest.insurerCode} failed extraction (${
        f.truncated ? 'output truncated' : f.retryable ? 'transient error' : 'permanent error'
      }): ${truncate(f.error, 250)}`,
  );

  const combinedWarnings = [
    ...workbookText.warnings,
    ...discovery.output.warnings,
    ...partialFailureWarnings,
  ];

  return {
    ok: true,
    products: merged,
    proposedClient: discovery.output.proposedClient,
    proposedPolicyEntities: discovery.output.proposedPolicyEntities,
    proposedBenefitYear: discovery.output.proposedBenefitYear,
    proposedInsurers: canonicalisedProposedInsurers,
    proposedPool: discovery.output.proposedPool,
    proposedTpa: discovery.output.proposedTpa ?? null,
    warnings: combinedWarnings,
    meta: {
      model: discovery.model,
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
      cacheReadTokens: totalUsage.cacheReadTokens,
      cacheCreationTokens: totalUsage.cacheCreationTokens,
      latencyMs: Date.now() - wallStart,
      workbookChars: workbookText.totalChars,
      workbookTruncated: workbookText.truncated,
      sheetsCount: workbookText.sheets.length,
      retried:
        discovery.retried ||
        fanOut.successes.some((s) => s.retried) ||
        fanOut.failures.some((f) => f.error.includes('retry failed')),
      productsRequested,
      productsExtracted,
      productsFailed,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function serializeWorkbookSafely(
  buffer: Buffer,
): Promise<{ ok: true; text: WorkbookText } | { ok: false; error: string }> {
  try {
    return { ok: true, text: await workbookToText(buffer) };
  } catch (err) {
    return {
      ok: false,
      error: `Workbook could not be serialized: ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }
}

async function safeProgress(
  handler: RunnerProgressHandler | undefined,
  event: RunnerProgressEvent,
): Promise<void> {
  if (!handler) return;
  try {
    await handler(event);
  } catch (err) {
    // Progress emission failures must not poison the run. Log and
    // continue.
    console.error('[ai-extraction] progress emission failed:', err);
  }
}

function productKey(m: ProductManifestEntry | ExtractedProduct): string {
  return `${m.productTypeCode}::${m.insurerCode}`;
}

function indexHeuristic(products: ExtractedProduct[]): Map<string, ExtractedProduct> {
  const map = new Map<string, ExtractedProduct>();
  for (const p of products) map.set(productKey(p), p);
  return map;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

// ─────────────────────────────────────────────────────────────
// Insurer-code canonicalisation
// ─────────────────────────────────────────────────────────────
//
// The tenant's ProductType.parsingRules templates may be keyed under
// short or legacy insurer codes (e.g. `GE`, `ZI`, `CI`) while the
// Insurer registry holds the canonical codes (`GE_LIFE`, `ZURICH`,
// `CHUBB`). The AI discovery pass receives the catalogue insurer list
// as context and tends to emit the canonical form, while the heuristic
// parser emits whatever key the tenant used in parsingRules. Without
// an alias step, the same real-world insurer ends up with two distinct
// productKey values and `mergeProducts` cannot dedupe.
//
// Resolution:
// 1. Catalogue-aware match: any heuristic code that matches a catalogue
//    insurer's `code` or `name` (case-insensitive, alphanumeric-only,
//    short ⊂ long) gets aliased to the catalogue's canonical code.
// 2. Discovery-aware match: any AI-proposed code whose rawLabel matches
//    a catalogue insurer's name gets aliased to the catalogue code.
// 3. Heuristic ↔ AI bridging: if the heuristic code shares a fuzzy
//    label with a discovery proposal but neither maps to a catalogue
//    code, prefer the AI's code (it's the longer, more explicit form).
//
// The map is one-way: `from` (legacy) → `to` (canonical). A code that
// is already canonical is absent from the map and survives unchanged.
function buildInsurerAliasMap(args: {
  heuristicCodes: string[];
  proposedInsurers: AiOutputInsurer[];
  catalogueInsurers: CatalogueContext['insurers'];
}): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const addAlias = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    // Avoid alias chains (a → b → c). The first canonical wins.
    if (aliasMap.has(from)) return;
    aliasMap.set(from, to);
  };

  // Step 1: heuristic codes → catalogue codes.
  // For each heuristic code that is NOT already a catalogue code,
  // try to find a catalogue insurer it overlaps with.
  for (const h of args.heuristicCodes) {
    if (args.catalogueInsurers.some((c) => c.code === h)) continue;
    const hit = args.catalogueInsurers.find(
      (c) => insurerLabelsMatch(c.code, h) || insurerLabelsMatch(c.name, h),
    );
    if (hit) addAlias(h, hit.code);
  }

  // Step 2: AI proposed codes → catalogue codes.
  // The AI may invent a synonymous code (`GREAT_EASTERN` vs `GE_LIFE`)
  // even though the catalogue has the official one. Alias to catalogue.
  for (const p of args.proposedInsurers) {
    if (args.catalogueInsurers.some((c) => c.code === p.code)) continue;
    const hit = args.catalogueInsurers.find(
      (c) => insurerLabelsMatch(c.name, p.rawLabel) || insurerLabelsMatch(c.code, p.code),
    );
    if (hit) addAlias(p.code, hit.code);
  }

  // Step 3: bridging — heuristic code that didn't map to catalogue but
  // does fuzzy-match an AI proposed insurer. Prefer the AI's code.
  for (const h of args.heuristicCodes) {
    if (aliasMap.has(h) || args.catalogueInsurers.some((c) => c.code === h)) continue;
    const proposed = args.proposedInsurers.find(
      (p) => insurerLabelsMatch(p.code, h) || insurerLabelsMatch(p.rawLabel, h),
    );
    if (proposed) addAlias(h, aliasMap.get(proposed.code) ?? proposed.code);
  }

  return aliasMap;
}

// Two insurer labels match if one is a substring of the other after
// normalising (lowercase, alphanumeric-only). Tuned for short-vs-long
// pairs like `GE` ⊂ `GE_LIFE`, `ZI` ⊂ `ZURICH_INSURANCE`. Bare
// equality also counts. Empty strings never match.
function insurerLabelsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Require at least 2 chars in the shorter string to count as a hit;
  // otherwise we'd alias single letters to anything containing them.
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length < 2) return false;
  return longer.includes(shorter);
}

function applyInsurerAliasToProducts(
  products: ExtractedProduct[],
  alias: Map<string, string>,
): ExtractedProduct[] {
  if (alias.size === 0) return products;
  return products.map((p) => {
    const aliased = alias.get(p.insurerCode);
    return aliased && aliased !== p.insurerCode ? { ...p, insurerCode: aliased } : p;
  });
}

// After aliasing, two proposed-insurer rows can collapse onto the same
// canonical code. Fold them, summing productCount and keeping the
// highest confidence + the longer rawLabel.
function dedupeProposedInsurers(rows: AiOutputInsurer[]): AiOutputInsurer[] {
  const map = new Map<string, AiOutputInsurer>();
  for (const r of rows) {
    const existing = map.get(r.code);
    if (!existing) {
      map.set(r.code, r);
      continue;
    }
    map.set(r.code, {
      code: r.code,
      rawLabel: r.rawLabel.length > existing.rawLabel.length ? r.rawLabel : existing.rawLabel,
      productCount: existing.productCount + r.productCount,
      confidence: Math.max(existing.confidence, r.confidence),
    });
  }
  return Array.from(map.values());
}

function buildMetaForZeroProducts(args: {
  workbookText: WorkbookText;
  wallStart: number;
  provider: FoundryProvider;
  family: ReturnType<typeof detectModelFamily>;
  discoveryUsage: FoundryUsage;
  discoveryRetried: boolean;
  model: string;
}): AiRunnerSuccess['meta'] {
  return {
    model: args.model,
    inputTokens: args.discoveryUsage.inputTokens,
    outputTokens: args.discoveryUsage.outputTokens,
    cacheReadTokens: args.discoveryUsage.cacheReadTokens,
    cacheCreationTokens: args.discoveryUsage.cacheCreationTokens,
    latencyMs: Date.now() - args.wallStart,
    workbookChars: args.workbookText.totalChars,
    workbookTruncated: args.workbookText.truncated,
    sheetsCount: args.workbookText.sheets.length,
    retried: args.discoveryRetried,
    productsRequested: 0,
    productsExtracted: 0,
    productsFailed: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Plan rawCode sanitisation
// ─────────────────────────────────────────────────────────────
//
// The AI frequently emits duplicate plans: once with a short
// code ("A", "1") and again with a long descriptive rawCode
// ("Plan A: Hay Job Grade 16 and above" or the full category
// label). Both survive `mergePlans` because it keys on exact
// rawCode. This function:
//   1. Resolves each rawCode to a canonical short code
//   2. Deduplicates plans by the canonical code
//   3. Remaps premiumRates.planRawCode to match
//
// Resolution order:
//   a. Multi-line → first line (GHS footnote pattern)
//   b. "Plan X: description" → X (GTL/GPA pattern)
//   c. Long descriptive code when short-code plans exist →
//      map via category label matching, or drop

const PLAN_CODE_PREFIX_RE = /^Plan\s+([A-Za-z0-9]+)\s*[:\-–—]/i;
const SHORT_CODE_MAX_LEN = 10;

function isShortCode(code: string): boolean {
  return code.length <= SHORT_CODE_MAX_LEN && !code.includes('\n');
}

function sanitisePlanRawCodes(product: ExtractedProduct): ExtractedProduct {
  if (!product.plans || product.plans.length === 0) return product;

  type PlanT = ExtractedProduct['plans'][number];
  type RateT = ExtractedProduct['premiumRates'][number];
  const scheduleDepth = (p: PlanT) => Object.keys(p.schedule ?? {}).length;

  // Phase 1: classify plans and build rawCode → canonical mapping
  const codeMap = new Map<string, string>();
  const shortCodes = new Set<string>();

  for (const plan of product.plans) {
    const rc = plan.rawCode;
    // Multi-line → first line
    if (rc.includes('\n')) {
      const first = (rc.split('\n')[0] ?? rc).trim();
      codeMap.set(rc, first);
      if (isShortCode(first)) shortCodes.add(first);
      continue;
    }
    // "Plan A: description" → A
    const prefixMatch = rc.match(PLAN_CODE_PREFIX_RE);
    if (prefixMatch?.[1]) {
      codeMap.set(rc, prefixMatch[1]);
      shortCodes.add(prefixMatch[1]);
      continue;
    }
    if (isShortCode(rc)) {
      shortCodes.add(rc);
    }
  }

  // Phase 2: long descriptive codes that didn't resolve to short codes.
  // Includes plans Phase 1 mapped to a still-long canonical (e.g.
  // multi-line → first line that's still a category description).
  if (shortCodes.size > 0) {
    const categories = product.eligibility?.categories ?? [];
    for (const plan of product.plans) {
      const resolved = codeMap.get(plan.rawCode) ?? plan.rawCode;
      if (isShortCode(resolved)) continue;
      const planLabel = resolved.replace(/\s+/g, ' ').trim().toLowerCase();
      let mapped = false;
      for (const cat of categories) {
        const catLabel = cat.category.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!cat.defaultPlanRawCode) continue;
        const shorter = planLabel.length <= catLabel.length ? planLabel : catLabel;
        const longer = planLabel.length <= catLabel.length ? catLabel : planLabel;
        if (shorter.length >= 10 && longer.startsWith(shorter)) {
          codeMap.set(plan.rawCode, cat.defaultPlanRawCode);
          mapped = true;
          break;
        }
      }
      if (!mapped) codeMap.set(plan.rawCode, '');
    }
  }

  // Phase 3: dedup plans by canonical rawCode
  const planDedup = new Map<string, PlanT>();
  for (const plan of product.plans) {
    const canonical = codeMap.get(plan.rawCode) ?? plan.rawCode;
    if (canonical === '') continue;
    const existing = planDedup.get(canonical);
    if (!existing) {
      planDedup.set(canonical, { ...plan, rawCode: canonical });
      continue;
    }
    if (scheduleDepth(plan) > scheduleDepth(existing) || plan.confidence > existing.confidence) {
      planDedup.set(canonical, { ...plan, rawCode: canonical });
    }
  }

  // Phase 4: remap premiumRates, dedup by (planRawCode, coverTier, blockLabel)
  const rateDedup = new Map<string, RateT>();
  for (const r of product.premiumRates ?? []) {
    const canonical = codeMap.get(r.planRawCode) ?? r.planRawCode;
    if (canonical === '') continue;
    const remapped = canonical !== r.planRawCode ? { ...r, planRawCode: canonical } : r;
    const key = `${remapped.planRawCode}::${remapped.coverTier ?? '_'}::${remapped.blockLabel ?? '_'}`;
    const existing = rateDedup.get(key);
    if (!existing || remapped.confidence > existing.confidence) {
      rateDedup.set(key, remapped);
    }
  }

  return {
    ...product,
    plans: Array.from(planDedup.values()),
    premiumRates: Array.from(rateDedup.values()),
  };
}

// For plans with coverBasis = "per_employee_flat", any rate row where
// ratePerThousand is set (heuristic couldn't distinguish) should have
// its value moved to fixedAmount. The plan schema treats these as
// annual per-person amounts, not SI-relative rates.
function fixPerEmployeeFlatRates(product: ExtractedProduct): ExtractedProduct {
  const flatPlanCodes = new Set(
    product.plans.filter((p) => p.coverBasis === 'per_employee_flat').map((p) => p.rawCode),
  );
  if (flatPlanCodes.size === 0) return product;
  return {
    ...product,
    premiumRates: product.premiumRates.map((r) => {
      if (!flatPlanCodes.has(r.planRawCode) || r.ratePerThousand == null) return r;
      return { ...r, fixedAmount: r.ratePerThousand, ratePerThousand: null };
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// Heuristic-AI merge (unchanged from v1)
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
  const aiByKey = new Map<string, ExtractedProduct>();
  for (const p of ai) aiByKey.set(productKey(p), p);

  const merged: ExtractedProduct[] = [];
  const seenKeys = new Set<string>();

  for (const h of heuristic) {
    const k = productKey(h);
    seenKeys.add(k);
    const a = aiByKey.get(k);
    if (!a) {
      merged.push(h);
      continue;
    }
    merged.push(mergeOneProduct(h, a));
  }
  for (const a of ai) {
    if (!seenKeys.has(productKey(a))) merged.push(canonicaliseExtractionMeta(a));
  }
  return merged;
}

// AI-only products bypass mergeOneProduct, so their extractionMeta is
// whatever the model emitted. The schema is now lax (extractionMeta is
// optional and accepts unknown keys) so the model output may be absent
// or malformed. Force it to the canonical shape so downstream code can
// trust extractionMeta.overallConfidence and extractionMeta.extractorVersion.
function canonicaliseExtractionMeta(p: ExtractedProduct): ExtractedProduct {
  const overall = computeOverallConfidence(p);
  const aiMeta = (p.extractionMeta ?? {}) as {
    overallConfidence?: number;
    warnings?: string[];
  };
  return {
    ...p,
    extractionMeta: {
      overallConfidence:
        typeof aiMeta.overallConfidence === 'number' &&
        aiMeta.overallConfidence >= 0 &&
        aiMeta.overallConfidence <= 1
          ? Math.max(aiMeta.overallConfidence, overall)
          : overall,
      extractorVersion: AI_EXTRACTOR_VERSION,
      warnings: Array.isArray(aiMeta.warnings) ? aiMeta.warnings : [],
    },
  };
}

// Average confidence across the leaf envelopes, weighted equally. Empty
// products fall back to 0.5 — the broker should review these manually.
function computeOverallConfidence(p: ExtractedProduct): number {
  const samples: number[] = [];
  const push = (e: { confidence?: number } | undefined): void => {
    if (e && typeof e.confidence === 'number') samples.push(e.confidence);
  };
  push(p.header?.policyNumber);
  push(p.header?.period);
  push(p.header?.lastEntryAge);
  push(p.header?.administrationType);
  push(p.header?.currency);
  push(p.policyholder?.legalName);
  push(p.policyholder?.uen);
  push(p.policyholder?.address);
  for (const pl of p.plans ?? []) push(pl);
  for (const r of p.premiumRates ?? []) push(r);
  for (const b of p.benefits ?? []) push(b);
  if (samples.length === 0) return 0.5;
  const sum = samples.reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(1, sum / samples.length));
}

function mergeOneProduct(h: ExtractedProduct, a: ExtractedProduct): ExtractedProduct {
  return {
    productTypeCode: h.productTypeCode,
    insurerCode: h.insurerCode,
    header: {
      policyNumber: pickEnvelope(h.header?.policyNumber, a.header?.policyNumber),
      period: pickEnvelope(h.header?.period, a.header?.period),
      lastEntryAge: pickEnvelope(h.header?.lastEntryAge, a.header?.lastEntryAge),
      administrationType: pickEnvelope(h.header?.administrationType, a.header?.administrationType),
      currency: pickEnvelope(h.header?.currency, a.header?.currency),
    },
    policyholder: {
      legalName: pickEnvelope(h.policyholder?.legalName, a.policyholder?.legalName),
      uen: pickEnvelope(h.policyholder?.uen, a.policyholder?.uen),
      address: pickEnvelope(h.policyholder?.address, a.policyholder?.address),
      businessDescription: pickEnvelope(
        h.policyholder?.businessDescription,
        a.policyholder?.businessDescription,
      ),
      insuredEntities: dedupePolicyEntities([
        ...(h.policyholder?.insuredEntities ?? []),
        ...(a.policyholder?.insuredEntities ?? []),
      ]),
    },
    eligibility: {
      freeText: pickEnvelope(h.eligibility?.freeText, a.eligibility?.freeText),
      categories:
        (a.eligibility?.categories ?? []).length > 0
          ? (a.eligibility?.categories ?? [])
          : (h.eligibility?.categories ?? []),
    },
    plans: mergePlans(h.plans ?? [], a.plans ?? []),
    premiumRates: mergeRates(h.premiumRates ?? [], a.premiumRates ?? []),
    benefits: mergeBenefits(h.benefits ?? [], a.benefits ?? []),
    extractionMeta: {
      overallConfidence: Math.max(
        h.extractionMeta?.overallConfidence ?? 0,
        a.extractionMeta?.overallConfidence ?? 0,
      ),
      extractorVersion: AI_EXTRACTOR_VERSION,
      warnings: [...(h.extractionMeta?.warnings ?? []), ...(a.extractionMeta?.warnings ?? [])],
    },
  };
}

// Both args may be undefined when the AI's per-product output omits
// an optional sub-field (extracted-product.json marks lastEntryAge,
// administrationType, currency, uen, address, businessDescription,
// freeText etc. as optional). We synthesise an empty envelope so
// downstream consumers always see a complete shape.
function emptyEnvelope<T>(): FieldEnvelope<T> {
  return { value: null, confidence: 0 };
}

function pickEnvelope<T>(
  h: FieldEnvelope<T> | undefined,
  a: FieldEnvelope<T> | undefined,
): FieldEnvelope<T> {
  if (!h && !a) return emptyEnvelope<T>();
  if (!h) return normalizeEnvelope(a as FieldEnvelope<T>);
  if (!a) return normalizeEnvelope(h);
  if (h.confidence >= 1) return h;
  if (h.value != null && h.confidence >= a.confidence) return h;
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
