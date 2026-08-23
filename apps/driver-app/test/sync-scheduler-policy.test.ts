// apps/driver-app/test/sync-scheduler-policy.test.ts
import { describe, it, expect } from 'vitest';
import {
  decideSyncSchedule,
  SYNC_SCHEDULER_POLICY_VERSION,
  SYNC_IDLE_INTERVAL_MS,
  SYNC_BACKOFF_BASE_MS,
  SYNC_BACKOFF_MAX_MS,
  SYNC_BACKOFF_JITTER_RATIO,
  SYNC_CIRCUIT_BREAKER_THRESHOLD,
  type SyncSchedulerState,
  type SyncSchedulerDeps,
  TRANSPORT_FAILURE_OUTCOME,
} from '../src/sync/sync-scheduler-policy.js';

/** Deterministic deps: random=0.5 -> midpoint -> zero net jitter (testable backoff math). */
const NO_JITTER: SyncSchedulerDeps = { random: () => 0.5 };

const NOW = 1_700_000_000_000;

function state(overrides: Partial<SyncSchedulerState> = {}): SyncSchedulerState {
  return {
    online: true,
    appActive: true,
    lastSyncAtMs: null,
    lastOutcome: null,
    consecutiveTransportFailures: 0,
    ...overrides,
  };
}

describe('@fleet/driver-app - decideSyncSchedule basic', () => {
  it('skips offline regardless of trigger', () => {
    const r = decideSyncSchedule(state({ online: false }), 'push_wake', NOW);
    expect(r.action).toBe('skip');
    if (r.action === 'skip') expect(r.reason).toBe('offline');
  });

  it('runs immediately on push_wake even when app inactive', () => {
    const r = decideSyncSchedule(state({ appActive: false }), 'push_wake', NOW);
    expect(r.action).toBe('run_now');
  });

  it('runs immediately on network_online even when app inactive', () => {
    const r = decideSyncSchedule(state({ appActive: false }), 'network_online', NOW);
    expect(r.action).toBe('run_now');
  });

  it('skips when app inactive and timer fires (battery save)', () => {
    const r = decideSyncSchedule(state({ appActive: false }), 'timer_tick', NOW);
    expect(r.action).toBe('skip');
    if (r.action === 'skip') expect(r.reason).toBe('app_inactive');
  });

  it('runs on app_foreground even when state.appActive is stale (#496)', () => {
    const r = decideSyncSchedule(state({ appActive: false }), 'app_foreground', NOW);
    expect(r.action).toBe('run_now');
  });

  it('runs on network_online even when state.online is stale (#497)', () => {
    const r = decideSyncSchedule(state({ online: false }), 'network_online', NOW);
    expect(r.action).toBe('run_now');
  });

  it('still skips offline for non-network_online triggers when state.online=false', () => {
    const r = decideSyncSchedule(state({ online: false }), 'manual_retry', NOW);
    expect(r.action).toBe('skip');
    if (r.action === 'skip') expect(r.reason).toBe('offline');
  });

  it('still skips app_inactive when timer fires and state.appActive=false', () => {
    const r = decideSyncSchedule(state({ appActive: false }), 'timer_tick', NOW);
    expect(r.action).toBe('skip');
    if (r.action === 'skip') expect(r.reason).toBe('app_inactive');
  });

  it('offline beats manual_retry (no run when network unreachable, #513)', () => {
    const r = decideSyncSchedule(state({ online: false }), 'manual_retry', NOW);
    expect(r.action).toBe('skip');
    if (r.action === 'skip') expect(r.reason).toBe('offline');
  });

  it('app_inactive beats manual_retry (battery save when app backgrounded, #514)', () => {
    const r = decideSyncSchedule(state({ appActive: false }), 'manual_retry', NOW);
    expect(r.action).toBe('skip');
    if (r.action === 'skip') expect(r.reason).toBe('app_inactive');
  });

  it('runs at exact backoff boundary (1 failure, age=BASE_MS, #516)', () => {
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW - SYNC_BACKOFF_BASE_MS,
        lastOutcome: TRANSPORT_FAILURE_OUTCOME,
        consecutiveTransportFailures: 1,
      }),
      'timer_tick',
      NOW,
      NO_JITTER,
    );
    expect(r.action).toBe('run_now');
  });
  it('runs immediately on manual_retry', () => {
    const r = decideSyncSchedule(state(), 'manual_retry', NOW);
    expect(r.action).toBe('run_now');
  });

  it('runs immediately on pending_action_added', () => {
    const r = decideSyncSchedule(state(), 'pending_action_added', NOW);
    expect(r.action).toBe('run_now');
  });

  it('runs immediately on app_foreground', () => {
    const r = decideSyncSchedule(state(), 'app_foreground', NOW);
    expect(r.action).toBe('run_now');
  });
});

describe('@fleet/driver-app - decideSyncSchedule timer + idle interval', () => {
  it('runs on timer_tick when no prior sync', () => {
    const r = decideSyncSchedule(state(), 'timer_tick', NOW);
    expect(r.action).toBe('run_now');
  });

  it('defers timer_tick within idle interval', () => {
    const r = decideSyncSchedule(
      state({ lastSyncAtMs: NOW - 5_000, lastOutcome: 'last_idle' }),
      'timer_tick',
      NOW,
    );
    expect(r.action).toBe('defer');
    if (r.action === 'defer') {
      expect(r.reason).toBe('idle_interval');
      expect(r.nextEarliestAtMs).toBe(NOW - 5_000 + SYNC_IDLE_INTERVAL_MS);
    }
  });

  it('runs on timer_tick at exact idle interval boundary', () => {
    const r = decideSyncSchedule(
      state({ lastSyncAtMs: NOW - SYNC_IDLE_INTERVAL_MS, lastOutcome: 'last_idle' }),
      'timer_tick',
      NOW,
    );
    expect(r.action).toBe('run_now');
  });
});

describe('@fleet/driver-app - decideSyncSchedule transport failure backoff', () => {
  it('applies exponential backoff after transport failure (1 failure -> 5s, no jitter)', () => {
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW - 1_000,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: 1,
      }),
      'timer_tick',
      NOW,
      NO_JITTER,
    );
    expect(r.action).toBe('defer');
    if (r.action === 'defer') {
      expect(r.reason).toBe('backoff');
      expect(r.nextEarliestAtMs).toBe(NOW - 1_000 + SYNC_BACKOFF_BASE_MS);
    }
  });

  it('doubles backoff per consecutive failure', () => {
    // 3 failures -> 5s * 2^2 = 20s
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW - 1_000,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: 3,
      }),
      'timer_tick',
      NOW,
      NO_JITTER,
    );
    if (r.action !== 'defer') throw new Error('expected defer');
    expect(r.nextEarliestAtMs).toBe(NOW - 1_000 + SYNC_BACKOFF_BASE_MS * 4);
  });

  it('manual_retry bypasses backoff', () => {
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW - 1_000,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: 3,
      }),
      'manual_retry',
      NOW,
    );
    expect(r.action).toBe('run_now');
  });
});

describe('@fleet/driver-app - decideSyncSchedule circuit breaker', () => {
  it('opens circuit breaker after threshold consecutive failures', () => {
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: SYNC_CIRCUIT_BREAKER_THRESHOLD,
      }),
      'timer_tick',
      NOW,
    );
    expect(r.action).toBe('defer');
    if (r.action === 'defer') {
      expect(r.reason).toBe('circuit_breaker');
      expect(r.nextEarliestAtMs).toBe(NOW + SYNC_BACKOFF_MAX_MS);
    }
  });

  it('does NOT open circuit breaker at THRESHOLD - 1 failures', () => {
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW - SYNC_BACKOFF_MAX_MS - 1,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: SYNC_CIRCUIT_BREAKER_THRESHOLD - 1,
      }),
      'timer_tick',
      NOW,
    );
    expect(r.action).toBe('run_now');
  });
  it('manual_retry bypasses circuit breaker', () => {
    const r = decideSyncSchedule(state({ consecutiveTransportFailures: 99 }), 'manual_retry', NOW);
    expect(r.action).toBe('run_now');
  });

  it('push_wake bypasses circuit breaker', () => {
    const r = decideSyncSchedule(state({ consecutiveTransportFailures: 99 }), 'push_wake', NOW);
    expect(r.action).toBe('run_now');
  });
});

describe('@fleet/driver-app - sync-scheduler-policy stable identifiers', () => {
  it('exports policy version + intervals', () => {
    expect(SYNC_SCHEDULER_POLICY_VERSION).toBe('sync-scheduler-v1');
    expect(SYNC_IDLE_INTERVAL_MS).toBe(30_000);
    expect(SYNC_BACKOFF_BASE_MS).toBe(5_000);
    expect(SYNC_BACKOFF_MAX_MS).toBe(5 * 60_000);
    expect(SYNC_CIRCUIT_BREAKER_THRESHOLD).toBe(5);
  });
});

describe('@fleet/driver-app - decideSyncSchedule jitter', () => {
  it('adds positive jitter when random > 0.5', () => {
    const maxJitter: SyncSchedulerDeps = { random: () => 1 };
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW - 1_000,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: 1,
      }),
      'timer_tick',
      NOW,
      maxJitter,
    );
    if (r.action !== 'defer') throw new Error('expected defer');
    // base 5s + 25% jitter = 6.25s
    expect(r.nextEarliestAtMs).toBe(
      NOW - 1_000 + Math.round(SYNC_BACKOFF_BASE_MS * (1 + SYNC_BACKOFF_JITTER_RATIO)),
    );
  });

  it('adds negative jitter when random = 0', () => {
    const minJitter: SyncSchedulerDeps = { random: () => 0 };
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW - 1_000,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: 1,
      }),
      'timer_tick',
      NOW,
      minJitter,
    );
    if (r.action !== 'defer') throw new Error('expected defer');
    // base 5s - 25% jitter = 3.75s
    expect(r.nextEarliestAtMs).toBe(
      NOW - 1_000 + Math.round(SYNC_BACKOFF_BASE_MS * (1 - SYNC_BACKOFF_JITTER_RATIO)),
    );
  });

  it('exports SYNC_BACKOFF_JITTER_RATIO', () => {
    expect(SYNC_BACKOFF_JITTER_RATIO).toBe(0.25);
  });
});

describe('@fleet/driver-app - decideSyncSchedule circuit breaker recovery transitions', () => {
  it('network_online wakes circuit-breaker-open state to run_now (recovery probe)', () => {
    const r = decideSyncSchedule(
      state({
        online: true,
        lastSyncAtMs: NOW - 1_000,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: SYNC_CIRCUIT_BREAKER_THRESHOLD,
      }),
      'network_online',
      NOW,
    );
    expect(r.action).toBe('run_now');
  });

  it('app_foreground while circuit open runs probe (bypasses defer)', () => {
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW,
        lastOutcome: 'last_transport_failure',
        consecutiveTransportFailures: SYNC_CIRCUIT_BREAKER_THRESHOLD + 5,
      }),
      'app_foreground',
      NOW,
    );
    expect(r.action).toBe('run_now');
  });

  it('post-recovery state (failures cleared by orchestrator) returns to idle scheduling', () => {
    // Simulates orchestrator resetting consecutiveTransportFailures=0 after a successful sync.
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW - SYNC_IDLE_INTERVAL_MS,
        lastOutcome: 'last_applied',
        consecutiveTransportFailures: 0,
      }),
      'timer_tick',
      NOW,
    );
    expect(r.action).toBe('run_now');
  });
});

import fc from 'fast-check';

describe('@fleet/driver-app - decideSyncSchedule property invariants', () => {
  it('offline state skips with offline reason for non-network_online triggers', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'app_foreground',
          'timer_tick',
          'push_wake',
          'manual_retry',
          'pending_action_added' as const,
        ),
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        (trigger, failures, appActive) => {
          const r = decideSyncSchedule(
            {
              online: false,
              appActive,
              lastSyncAtMs: null,
              lastOutcome: null,
              consecutiveTransportFailures: failures,
            },
            trigger,
            NOW,
            NO_JITTER,
          );
          expect(r.action).toBe('skip');
          if (r.action === 'skip') expect(r.reason).toBe('offline');
          return true;
        },
      ),
    );
  });

  it('manual_retry always runs when online + app active regardless of failures', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (failures) => {
        const r = decideSyncSchedule(
          state({ consecutiveTransportFailures: failures }),
          'manual_retry',
          NOW,
          NO_JITTER,
        );
        expect(r.action).toBe('run_now');
        return true;
      }),
    );
  });

  it('backoff defer time stays within base..max bounds across wide failure range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (failures, randomVal) => {
          const r = decideSyncSchedule(
            state({
              lastSyncAtMs: NOW - 1,
              lastOutcome: TRANSPORT_FAILURE_OUTCOME,
              consecutiveTransportFailures: failures,
            }),
            'timer_tick',
            NOW,
            { random: () => randomVal },
          );
          if (r.action !== 'defer') return true;
          const delay = r.nextEarliestAtMs - (NOW - 1);
          // base * (1 - jitter) <= delay <= max * (1 + jitter)
          const minBound = Math.round(SYNC_BACKOFF_BASE_MS * (1 - SYNC_BACKOFF_JITTER_RATIO));
          const maxBound = Math.round(SYNC_BACKOFF_MAX_MS * (1 + SYNC_BACKOFF_JITTER_RATIO));
          expect(delay).toBeGreaterThanOrEqual(minBound);
          expect(delay).toBeLessThanOrEqual(maxBound);
          return true;
        },
      ),
    );
  });
  it('every decision carries policyVersion', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'app_foreground',
          'timer_tick',
          'push_wake',
          'network_online',
          'manual_retry',
          'pending_action_added' as const,
        ),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 0, max: 20 }),
        (trigger, online, appActive, failures) => {
          const r = decideSyncSchedule(
            {
              online,
              appActive,
              lastSyncAtMs: NOW - 1000,
              lastOutcome: 'last_transport_failure',
              consecutiveTransportFailures: failures,
            },
            trigger,
            NOW,
            NO_JITTER,
          );
          expect(r.policyVersion).toBe(SYNC_SCHEDULER_POLICY_VERSION);
          return true;
        },
      ),
    );
  });
});

describe('@fleet/driver-app - decideSyncSchedule mutation-hardening', () => {
  it('pending_action_added bypasses idle-interval defer (kills L57 FAST_TRACK_TRIGGERS literal mutant)', () => {
    // Setup state where the non-fast-track path would DEFER (within idle interval).
    // If 'pending_action_added' is in FAST_TRACK_TRIGGERS (original), trigger fast-tracks → run_now.
    // Mutated `''` removes it → trigger falls through to idle-interval check → defer.
    const r = decideSyncSchedule(
      state({ lastSyncAtMs: NOW - 1000, lastOutcome: null }), // 1s ago, within idle interval
      'pending_action_added',
      NOW,
    );
    expect(r.action).toBe('run_now');
  });

  it('backoffDelayMs at 0 failures returns 0 (kills L67 <=0 -> <0 mutant)', () => {
    // With 0 failures, lastSyncAtMs in the recent past, no transport failure outcome:
    // Original: backoffDelay returns 0 (because consecutiveFailures <= 0). requiredBackoff = IDLE_INTERVAL.
    // For the run path to hinge on backoff vs idle, we need lastOutcome = TRANSPORT_FAILURE with 0 failures.
    // Even though that\'s an unusual state (orchestrator never produces it), the policy must defend it.
    // Mutated `<` (instead of `<=`): with 0 failures, falls through to compute 2^-1*BASE = 2500 (then jitter).
    // requiredBackoff = 2500. If sinceLast=0 (just synced), original: requiredBackoff=0 (from backoffDelay)
    // → sinceLast(0) < requiredBackoff(0) is false → run_now.
    // Mutated: requiredBackoff = ~2500 → sinceLast(0) < 2500 is true → defer.
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW, // just synced (sinceLast = 0)
        lastOutcome: TRANSPORT_FAILURE_OUTCOME,
        consecutiveTransportFailures: 0,
      }),
      'timer_tick',
      NOW,
      NO_JITTER,
    );
    expect(r.action).toBe('run_now');
  });

  it('backoffDelayMs at 0 failures with timer_tick + just-synced runs (kills L67 conditional -> false mutant)', () => {
    // Original L67 `if (consecutiveFailures <= 0) return 0;` with failures=0 returns 0.
    // Mutated `if (false)` skips, computes baseDelay = BASE * 2^-1 = positive number.
    // Same test as above kills this too: requiredBackoff differs → action differs.
    const r = decideSyncSchedule(
      state({
        lastSyncAtMs: NOW, // sinceLast = 0
        lastOutcome: TRANSPORT_FAILURE_OUTCOME,
        consecutiveTransportFailures: 0,
      }),
      'timer_tick',
      NOW,
      NO_JITTER,
    );
    expect(r.action).toBe('run_now');
  });
});
