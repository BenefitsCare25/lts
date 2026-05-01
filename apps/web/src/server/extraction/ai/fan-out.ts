// =============================================================
// Fan-out orchestrator for the per-product extraction passes.
//
// Runs N product passes with bounded concurrency, partial failure
// tolerance, and progress streaming. The wizard polls the
// ExtractionDraft.progress JSONB; each completed pass writes a
// progress event so the broker sees "3 of 7 done" in real time.
//
// Concurrency policy:
//   - Limit: 3 in-flight at a time. Tuned for a typical Foundry
//     deployment's per-minute rate limit. Workbook caching keeps
//     input tokens cheap on calls 2..N+1, so saturating the rate
//     limit is more about output tokens than input.
//   - On retryable failure (5xx, 429, network) the offending call
//     surfaces as `retryable: true`. The orchestrator does not retry
//     the call (BullMQ owns whole-job retry). Future improvement:
//     per-call exponential backoff with jitter.
//
// Partial-failure policy:
//   - Per-product results are collected as either { ok: true } or
//     { ok: false, ... }. The runner accepts partial results — if
//     ≥1 product succeeds, the whole extraction is still useful.
//   - The runner caller decides when "too many products failed"
//     means the overall extraction should be marked FAILED. Default
//     in this module: never fail the whole extraction here; let the
//     runner apply its policy.
// =============================================================

import { type ProductPassInput, type ProductPassResult, runProductPass } from './product-pass';

export type FanOutInput = {
  // The shared per-call config (provider, prompts, workbook). The
  // manifest entry is the only thing that varies per call.
  perCallBase: Omit<ProductPassInput, 'manifest' | 'heuristicProduct'>;
  // The product manifest from the discovery pass.
  manifests: Array<{
    manifest: ProductPassInput['manifest'];
    heuristicProduct: ProductPassInput['heuristicProduct'];
  }>;
  // Concurrency cap. Defaults to 3.
  concurrency?: number;
  // Called whenever a pass starts or completes. The runner uses this
  // to update ExtractionDraft.progress so the wizard's poll picks up
  // real-time progress (live "in-progress" indicators per product).
  onProgress?: (event: ProgressEvent) => Promise<void> | void;
};

export type ProgressEvent =
  | {
      kind: 'started';
      productKey: string;
      total: number;
    }
  | {
      kind: 'completed';
      productKey: string;
      index: number; // 1-based among manifests, in completion order
      total: number;
      result: ProductPassResult;
    };

export type FanOutResult = {
  successes: Array<Extract<ProductPassResult, { ok: true }>>;
  failures: Array<Extract<ProductPassResult, { ok: false }>>;
  totalLatencyMs: number; // wall time, not sum
};

export async function runProductPasses(input: FanOutInput): Promise<FanOutResult> {
  const concurrency = Math.max(1, input.concurrency ?? 3);
  const total = input.manifests.length;
  const successes: Array<Extract<ProductPassResult, { ok: true }>> = [];
  const failures: Array<Extract<ProductPassResult, { ok: false }>> = [];

  let completedCount = 0;
  let cursor = 0;
  const startedAt = Date.now();

  // Hand-rolled bounded fan-out (no extra deps). Spawn `concurrency`
  // workers that pull from a shared cursor; each worker resolves when
  // the cursor exhausts.
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      const entry = input.manifests[i];
      if (!entry) return;

      const productKey = `${entry.manifest.productTypeCode}::${entry.manifest.insurerCode}`;

      if (input.onProgress) {
        try {
          await input.onProgress({ kind: 'started', productKey, total });
        } catch {
          // Progress emission failures must not poison the run.
        }
      }

      const result = await runProductPass({
        ...input.perCallBase,
        manifest: entry.manifest,
        heuristicProduct: entry.heuristicProduct,
      });

      if (result.ok) successes.push(result);
      else failures.push(result);

      completedCount++;
      if (input.onProgress) {
        try {
          await input.onProgress({
            kind: 'completed',
            productKey,
            index: completedCount,
            total,
            result,
          });
        } catch {
          // Progress emission failures must not poison the run.
        }
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  return {
    successes,
    failures,
    totalLatencyMs: Date.now() - startedAt,
  };
}
