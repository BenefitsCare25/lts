// =============================================================
// Anthropic Claude client — singleton wrapper for the AI
// extraction layer.
//
// Why a singleton: Anthropic.SDK constructs an HTTPS keep-alive
// agent internally. Sharing one instance across requests reuses
// connections (40-100ms saved per call) and centralises retry
// + timeout policy.
//
// Why prompt caching: extractor prompts include a stable system
// preamble (≈ 2-4k tokens of product-type schema, examples,
// confidence rubric). Caching it cuts input cost ~90% per
// extraction call.
//
// Failure handling: callers receive `{ ok, value | error }` so
// extraction stages can attach errors to the draft progress map
// instead of crashing the BullMQ worker. We do not throw to the
// boundary — extraction failures are recorded as draft state.
// =============================================================

import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';

// Default model — Sonnet 4.6 is the best price/performance for
// structured extraction at the time of writing. Override via
// CLAUDE_EXTRACTION_MODEL env var if a swap is needed.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

let _client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    throw new Error(
      'ANTHROPIC_API_KEY is not configured. Set it in .env.local or your environment before running extraction.',
    );
  }
  _client = new Anthropic({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });
  return _client;
}

export type ClaudeCallParams = Omit<MessageCreateParamsNonStreaming, 'model'> & {
  model?: string;
};

export type ClaudeCallResult =
  | { ok: true; message: Message }
  | { ok: false; error: string; retryable: boolean };

export async function callClaude(params: ClaudeCallParams): Promise<ClaudeCallResult> {
  const client = getClaudeClient();
  const model = params.model ?? process.env.CLAUDE_EXTRACTION_MODEL ?? DEFAULT_MODEL;
  const started = Date.now();
  try {
    const message = await client.messages.create({
      ...params,
      model,
    });
    const elapsed = Date.now() - started;
    // Lightweight breadcrumb; replace with App Insights span when the
    // observability wiring lands. Using stderr to avoid the stdout
    // console.log lint rule for production code.
    const usage = message.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
    };
    process.stderr.write(
      `[claude] ok model=${model} input=${usage.input_tokens} output=${usage.output_tokens} cache_read=${usage.cache_read_input_tokens ?? 0} ms=${elapsed}\n`,
    );
    return { ok: true, message };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown Claude API error';
    const retryable =
      err instanceof Anthropic.APIError &&
      (err.status === 429 || err.status === 500 || err.status === 502 || err.status === 503);
    process.stderr.write(`[claude] error model=${model} retryable=${retryable} ${errorMessage}\n`);
    return { ok: false, error: errorMessage, retryable };
  }
}

// Helper: extract the first JSON object from a Claude text response.
// Extractors should prefer tool-use / structured output, but for
// modules that prompt for a JSON-only reply this trims fences and
// returns parsed value, or `null` if parsing fails.
export function extractJson<T = unknown>(message: Message): T | null {
  const text = message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (text.length === 0) return null;
  // Strip ```json fences if present.
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const candidate = fenced?.[1] ?? text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
