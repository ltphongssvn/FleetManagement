// apps/driver-app/src/config/vn-retry-policy.ts
// Cross-region retry tuning. Drivers on mobile networks in Vietnam reach a
// backend on Railway (US/SG): higher, more variable RTT + transient mobile
// loss. The raw server retryPolicy is too aggressive. Pure, bounded, and
// idempotent: only ever relaxes (raises floors / widens jitter / lifts the
// attempt ceiling), never makes a server policy stricter.
export interface RetryEntry {
  readonly maxAttempts: number;
  readonly baseSeconds: number;
  readonly jitterRatio: number;
}

// Floors chosen for VN<->Railway: ~2s first backoff absorbs cross-region
// RTT; >=0.3 jitter decorrelates retry storms; >=5 attempts rides out
// transient cellular loss. Clamps keep jitter a valid ratio.
const MIN_BASE_SECONDS = 2;
const MIN_JITTER_RATIO = 0.3;
const MAX_JITTER_RATIO = 1;
const MIN_MAX_ATTEMPTS = 5;

export function adjustRetryForVn(entry: RetryEntry): RetryEntry {
  return {
    maxAttempts: Math.max(entry.maxAttempts, MIN_MAX_ATTEMPTS),
    baseSeconds: Math.max(entry.baseSeconds, MIN_BASE_SECONDS),
    jitterRatio: Math.min(MAX_JITTER_RATIO, Math.max(entry.jitterRatio, MIN_JITTER_RATIO)),
  };
}

export function adjustRetryMap(
  map: Readonly<Record<string, RetryEntry>>,
): Record<string, RetryEntry> {
  const out: Record<string, RetryEntry> = {};
  for (const [key, entry] of Object.entries(map)) {
    out[key] = adjustRetryForVn(entry);
  }
  return out;
}
