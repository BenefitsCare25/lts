// =============================================================
// In-memory sliding-window rate limiter.
//
// Phase 1 use cases are bounded — sign-in attempts at < 1 RPS per
// user — so an in-process Map is fine for a single replica. When
// the Container App scales to N replicas the limiter is per-replica;
// the effective allowance becomes N × the configured limit. That is
// good enough as a brute-force speed bump for now; a coordinated
// distributed limiter (Upstash Redis, or a Postgres advisory lock)
// is a Phase 2 follow-up if Auth becomes a real attack target.
//
// Memory bound. Each key holds at most `limit` timestamps (older
// ones are pruned on every check). Stale keys age out after the
// window expires; we run a low-frequency sweep on every Nth call to
// keep the Map from growing unbounded under attack.
// =============================================================

type WindowState = {
  // Hits as Unix-ms timestamps, oldest first. Pruned on every check.
  hits: number[];
};

export type RateLimitResult =
  | { allowed: true; remaining: number; retryAfterSec: 0 }
  | { allowed: false; remaining: 0; retryAfterSec: number };

export class SlidingWindowLimiter {
  private readonly buckets = new Map<string, WindowState>();
  private sweepCounter = 0;
  private readonly sweepEvery = 256;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (limit <= 0 || windowMs <= 0) {
      throw new Error('SlidingWindowLimiter: limit and windowMs must be positive.');
    }
  }

  // Returns { allowed: true, remaining } and records the hit, or
  // { allowed: false, retryAfterSec } and does NOT record (so a
  // genuinely-rate-limited caller doesn't extend their lockout by
  // continuing to hammer). Idempotent across concurrent calls; the
  // worst race is one extra hit slipping past, which is acceptable.
  check(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let state = this.buckets.get(key);
    if (!state) {
      state = { hits: [] };
      this.buckets.set(key, state);
    }

    // Prune old hits in place. The `?? Number.POSITIVE_INFINITY`
    // guard is unreachable when length > 0 but keeps the typechecker
    // happy without a non-null assertion.
    while (state.hits.length > 0 && (state.hits[0] ?? Number.POSITIVE_INFINITY) < cutoff) {
      state.hits.shift();
    }

    if (state.hits.length >= this.limit) {
      const oldest = state.hits[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSec };
    }

    state.hits.push(now);
    this.maybeSweep(now);
    return { allowed: true, remaining: this.limit - state.hits.length, retryAfterSec: 0 };
  }

  // Periodic GC of expired buckets so a key churn doesn't grow the
  // Map without bound. Triggered probabilistically — we don't need
  // strict cadence, just upper-bound size.
  private maybeSweep(now: number): void {
    this.sweepCounter += 1;
    if (this.sweepCounter < this.sweepEvery) return;
    this.sweepCounter = 0;
    const cutoff = now - this.windowMs;
    for (const [key, state] of this.buckets) {
      while (state.hits.length > 0 && (state.hits[0] ?? Number.POSITIVE_INFINITY) < cutoff) {
        state.hits.shift();
      }
      if (state.hits.length === 0) this.buckets.delete(key);
    }
  }
}

// Sign-in limits — applied separately by IP and by email so a
// single attacker testing many emails from one IP and many IPs
// testing one email both get throttled. Generous defaults; tighten
// after observing real traffic.
export const signInIpLimiter = new SlidingWindowLimiter(20, 5 * 60 * 1000);
export const signInEmailLimiter = new SlidingWindowLimiter(8, 5 * 60 * 1000);

// Read the client's source IP from request headers in the order
// Container Apps / Vercel / Cloudflare set them. Falls back to the
// literal string "unknown" so an empty value still maps to a stable
// bucket — better than skipping the limiter entirely.
export function readClientIp(headers: {
  get(name: string): string | null;
}): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    // First entry is the originating client; downstream proxies append.
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  const cf = headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  return 'unknown';
}
