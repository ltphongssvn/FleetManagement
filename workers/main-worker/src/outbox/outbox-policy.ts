// workers/main-worker/src/outbox/outbox-policy.ts
// Pure functions for outbox processing. All impurity (clock, randomness)
// is injected for deterministic tests.
import type { QueueName } from '../queues.js';

const MS_PER_SECOND = 1000 as const;
const POLICY_VERSION = 'outbox-retry-v1' as const;

export type OutboxStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'dead_letter';

export interface OutboxRow {
  readonly outboxId: string;
  readonly queueName: QueueName;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date | null;
  readonly payload: unknown;
}

/** Per-queue retry policy. */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseSeconds: number;
  /** Jitter ratio (0-1). 0.25 = +/-25% jitter. */
  readonly jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 5,
  baseSeconds: 1,
  jitterRatio: 0.25,
});

export interface AttemptDeps {
  readonly now: () => number;
  readonly random: () => number;
}

const REAL_DEPS: AttemptDeps = { now: Date.now, random: Math.random };

export interface AttemptDecision {
  readonly status: OutboxStatus;
  readonly nextAttempts: number;
  readonly nextAttemptAt: Date | null;
  readonly policyVersion: string;
}

/** Decide next status after a processing attempt. Pure given deps. */
export function nextStatusAfterAttempt(
  current: OutboxRow,
  outcome: 'success' | 'failure',
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  deps: AttemptDeps = REAL_DEPS,
): AttemptDecision {
  const attempts = current.attempts + 1;
  if (outcome === 'success') {
    return {
      status: 'succeeded',
      nextAttempts: attempts,
      nextAttemptAt: null,
      policyVersion: POLICY_VERSION,
    };
  }
  if (attempts >= policy.maxAttempts) {
    return {
      status: 'dead_letter',
      nextAttempts: attempts,
      nextAttemptAt: null,
      policyVersion: POLICY_VERSION,
    };
  }
  const baseSeconds = policy.baseSeconds * 2 ** attempts;
  const jitter = baseSeconds * (deps.random() * 2 * policy.jitterRatio - policy.jitterRatio);
  const nextMs = deps.now() + (baseSeconds + jitter) * MS_PER_SECOND;
  return {
    status: 'failed',
    nextAttempts: attempts,
    nextAttemptAt: new Date(nextMs),
    policyVersion: POLICY_VERSION,
  };
}

/** Eligible-for-pickup filter: pending OR (failed AND nextAttemptAt <= now). */
export function isEligibleForPickup(row: OutboxRow, now: Date = new Date()): boolean {
  if (row.status === 'pending') return true;
  if (row.status === 'failed' && row.nextAttemptAt !== null && row.nextAttemptAt <= now)
    return true;
  return false;
}

export const OUTBOX_POLICY_VERSION = POLICY_VERSION;
