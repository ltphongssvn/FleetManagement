// apps/driver-app/src/sync/sync-scheduler-policy.ts
// Pure scheduler policy: given current state + trigger, decides whether to run
// the next sync iteration. PDF Day-One #6: 'Expo Push fallback for offline-to-
// online wake'. The scheduler keeps the loop event-driven (push/timer/online)
// without polling battery dry.

export const SYNC_SCHEDULER_POLICY_VERSION = 'sync-scheduler-v1' as const;

/** Idle poll interval when app foregrounded but no triggers fire. */
export const SYNC_IDLE_INTERVAL_MS = 30_000;
/** Backoff after transport failure (capped exponential, see policy below). */
export const SYNC_BACKOFF_BASE_MS = 5_000;
export const SYNC_BACKOFF_MAX_MS = 5 * 60_000;
/** Jitter ratio. Mirrors outbox-policy.ts default; spreads concurrent retries. */
export const SYNC_BACKOFF_JITTER_RATIO = 0.25;
/** After this many consecutive transport failures, pause until external trigger. */
export const SYNC_CIRCUIT_BREAKER_THRESHOLD = 5;

export type SyncTrigger =
  | 'app_foreground'
  | 'timer_tick'
  | 'push_wake'
  | 'network_online'
  | 'manual_retry'
  | 'pending_action_added';

export const TRANSPORT_FAILURE_OUTCOME = 'last_transport_failure' as const;

export type SyncSchedulerOutcome =
  | 'last_idle'
  | 'last_applied'
  | 'last_cursor_expired_recovered'
  | 'last_protocol_violation'
  | typeof TRANSPORT_FAILURE_OUTCOME
  | 'last_storage_failure';

export interface SyncSchedulerState {
  readonly online: boolean;
  readonly appActive: boolean;
  readonly lastSyncAtMs: number | null;
  readonly lastOutcome: SyncSchedulerOutcome | null;
  /** Orchestrator contract: reset to 0 on ANY non-transport_failure outcome
   *  (applied / idle / cursor_expired_recovered / protocol_violation / storage_failure). */
  readonly consecutiveTransportFailures: number;
}

export type SyncSchedulerDecision =
  | { readonly action: 'run_now'; readonly policyVersion: typeof SYNC_SCHEDULER_POLICY_VERSION }
  | { readonly action: 'defer'; readonly nextEarliestAtMs: number; readonly reason: 'backoff' | 'idle_interval' | 'circuit_breaker'; readonly policyVersion: typeof SYNC_SCHEDULER_POLICY_VERSION }
  | { readonly action: 'skip'; readonly reason: 'offline' | 'app_inactive'; readonly policyVersion: typeof SYNC_SCHEDULER_POLICY_VERSION };

const FAST_TRACK_TRIGGERS: ReadonlySet<SyncTrigger> = new Set([
  'manual_retry',
  'push_wake',
  'network_online',
  'app_foreground',
  'pending_action_added',
]);

export interface SyncSchedulerDeps {
  readonly random: () => number;
}

const REAL_DEPS: SyncSchedulerDeps = { random: Math.random };

function backoffDelayMs(consecutiveFailures: number, random: () => number): number {
  if (consecutiveFailures <= 0) return 0;
  const baseDelay = SYNC_BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1);
  const capped = Math.min(baseDelay, SYNC_BACKOFF_MAX_MS);
  // Symmetric jitter: capped * [1 - ratio, 1 + ratio]. Mirrors outbox-policy.
  const jitter = capped * (random() * 2 * SYNC_BACKOFF_JITTER_RATIO - SYNC_BACKOFF_JITTER_RATIO);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Decide whether to run sync given current state, the trigger, and current time.
 * Pure: same inputs always yield same decision.
 */
export function decideSyncSchedule(
  state: SyncSchedulerState,
  trigger: SyncTrigger,
  nowMs: number,
  deps: SyncSchedulerDeps = REAL_DEPS,
): SyncSchedulerDecision {
  // Trigger-as-authority: network_online and app_foreground signal state
  // transitions the adapter may not have committed to state yet. Treat the
  // trigger as authoritative for its respective dimension so the policy doesn't
  // skip a sync the OS just woke us up to do.
  const triggerAssertsOnline = trigger === 'network_online';
  const triggerAssertsActive = trigger === 'app_foreground' || trigger === 'network_online' || trigger === 'push_wake';

  if (!state.online && !triggerAssertsOnline) {
    return { action: 'skip', reason: 'offline', policyVersion: SYNC_SCHEDULER_POLICY_VERSION };
  }
  if (!state.appActive && !triggerAssertsActive) {
    return { action: 'skip', reason: 'app_inactive', policyVersion: SYNC_SCHEDULER_POLICY_VERSION };
  }

  // Fast-track triggers bypass backoff/circuit. New triggers can be added to the
  // FAST_TRACK_TRIGGERS set without modifying the decision logic (OCP).
  if (FAST_TRACK_TRIGGERS.has(trigger)) {
    return { action: 'run_now', policyVersion: SYNC_SCHEDULER_POLICY_VERSION };
  }

  // Timer tick: respect circuit breaker + backoff.
  if (state.consecutiveTransportFailures >= SYNC_CIRCUIT_BREAKER_THRESHOLD) {
    return {
      action: 'defer',
      nextEarliestAtMs: nowMs + SYNC_BACKOFF_MAX_MS,
      reason: 'circuit_breaker',
      policyVersion: SYNC_SCHEDULER_POLICY_VERSION,
    };
  }

  if (state.lastSyncAtMs !== null) {
    const sinceLastMs = nowMs - state.lastSyncAtMs;
    const requiredBackoffMs = state.lastOutcome === TRANSPORT_FAILURE_OUTCOME
      ? backoffDelayMs(state.consecutiveTransportFailures, deps.random)
      : SYNC_IDLE_INTERVAL_MS;
    if (sinceLastMs < requiredBackoffMs) {
      return {
        action: 'defer',
        nextEarliestAtMs: state.lastSyncAtMs + requiredBackoffMs,
        reason: state.lastOutcome === TRANSPORT_FAILURE_OUTCOME ? 'backoff' : 'idle_interval',
        policyVersion: SYNC_SCHEDULER_POLICY_VERSION,
      };
    }
  }
  return { action: 'run_now', policyVersion: SYNC_SCHEDULER_POLICY_VERSION };
}
