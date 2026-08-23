// apps/driver-app/test/sync-status-presenter.test.ts
import { describe, it, expect } from 'vitest';
import {
  presentSyncStatus,
  SYNC_STATUS_PRESENTER_VERSION,
} from '../src/sync/sync-status-presenter.js';
import type { SyncSchedulerState } from '../src/sync/sync-scheduler-policy.js';

const NOW = 1_700_000_000_000;

function s(o: Partial<SyncSchedulerState> = {}): SyncSchedulerState {
  return {
    online: true,
    appActive: true,
    lastSyncAtMs: null,
    lastOutcome: null,
    consecutiveTransportFailures: 0,
    ...o,
  };
}

describe('@fleet/driver-app - presentSyncStatus', () => {
  it('shows offline when not online', () => {
    expect(presentSyncStatus(s({ online: false }), NOW).kind).toBe('offline');
  });

  it('shows app_inactive when backgrounded', () => {
    expect(presentSyncStatus(s({ appActive: false }), NOW).kind).toBe('app_inactive');
  });

  it('shows circuit_open after threshold failures', () => {
    const v = presentSyncStatus(
      s({ consecutiveTransportFailures: 5, lastOutcome: 'last_transport_failure' }),
      NOW,
    );
    expect(v.kind).toBe('circuit_open');
    expect(v.secondary).toBe('5 failed attempts');
  });

  it('shows backoff when transport failed but under threshold', () => {
    const v = presentSyncStatus(
      s({ consecutiveTransportFailures: 2, lastOutcome: 'last_transport_failure' }),
      NOW,
    );
    expect(v.kind).toBe('backoff');
    expect(v.secondary).toContain('Attempt 3');
  });

  it('shows never_synced when no prior sync', () => {
    expect(presentSyncStatus(s(), NOW).kind).toBe('never_synced');
  });

  it('shows just-synced for recent sync (<60s)', () => {
    const v = presentSyncStatus(s({ lastSyncAtMs: NOW - 30_000, lastOutcome: 'last_idle' }), NOW);
    expect(v.kind).toBe('idle');
    expect(v.secondary).toBe('Just synced');
  });

  it('shows minutes-ago for older sync', () => {
    const v = presentSyncStatus(
      s({ lastSyncAtMs: NOW - 5 * 60_000, lastOutcome: 'last_idle' }),
      NOW,
    );
    expect(v.kind).toBe('idle');
    expect(v.secondary).toBe('Synced 5m ago');
  });

  it('rolls over to "1m ago" at exact 60_000ms boundary (#524)', () => {
    const v = presentSyncStatus(s({ lastSyncAtMs: NOW - 60_000, lastOutcome: 'last_idle' }), NOW);
    expect(v.secondary).toBe('Synced 1m ago');
  });

  it('rolls over to hours past 60m', () => {
    const v = presentSyncStatus(
      s({ lastSyncAtMs: NOW - 2 * 60 * 60_000, lastOutcome: 'last_idle' }),
      NOW,
    );
    expect(v.secondary).toBe('Synced 2h ago');
  });

  it('rolls over to days past 24h (#527)', () => {
    const v = presentSyncStatus(
      s({ lastSyncAtMs: NOW - 2 * 24 * 60 * 60_000, lastOutcome: 'last_idle' }),
      NOW,
    );
    expect(v.secondary).toBe('Synced 2d ago');
  });

  it('shows backoff at THRESHOLD-1 failures, not circuit_open (#576)', () => {
    const v = presentSyncStatus(
      s({ consecutiveTransportFailures: 4, lastOutcome: 'last_transport_failure' }),
      NOW,
    );
    expect(v.kind).toBe('backoff');
  });

  it('shows circuit_open at exact THRESHOLD failures (#576)', () => {
    const v = presentSyncStatus(
      s({ consecutiveTransportFailures: 5, lastOutcome: 'last_transport_failure' }),
      NOW,
    );
    expect(v.kind).toBe('circuit_open');
  });

  it('offline takes precedence over app_inactive (#577)', () => {
    const v = presentSyncStatus(s({ online: false, appActive: false }), NOW);
    expect(v.kind).toBe('offline');
  });

  it('offline takes precedence over circuit_open (#577)', () => {
    const v = presentSyncStatus(
      s({ online: false, consecutiveTransportFailures: 10, lastOutcome: 'last_transport_failure' }),
      NOW,
    );
    expect(v.kind).toBe('offline');
  });

  it('circuit_open requires lastOutcome=last_transport_failure (#593)', () => {
    const v = presentSyncStatus(
      s({ consecutiveTransportFailures: 10, lastOutcome: 'last_idle', lastSyncAtMs: NOW - 30_000 }),
      NOW,
    );
    expect(v.kind).toBe('idle');
  });
  it('exports stable version', () => {
    expect(SYNC_STATUS_PRESENTER_VERSION).toBe('sync-status-v1');
  });
});

import fc from 'fast-check';

describe('@fleet/driver-app - presentSyncStatus property invariants', () => {
  it('never throws on arbitrary state + nowMs', () => {
    fc.assert(
      fc.property(
        fc.record({
          online: fc.boolean(),
          appActive: fc.boolean(),
          lastSyncAtMs: fc.option(fc.integer({ min: 0, max: 10_000_000_000_000 })),
          lastOutcome: fc.option(
            fc.constantFrom(
              'last_idle',
              'last_applied',
              'last_transport_failure',
              'last_storage_failure',
              'last_protocol_violation',
              'last_cursor_expired_recovered' as const,
            ),
          ),
          consecutiveTransportFailures: fc.integer({ min: 0, max: 100 }),
        }),
        fc.integer({ min: 0, max: 10_000_000_000_000 }),
        (state, nowMs) => {
          const v = presentSyncStatus(state, nowMs);
          expect(typeof v.label).toBe('string');
          expect(typeof v.secondary).toBe('string');
          expect([
            'idle',
            'offline',
            'app_inactive',
            'backoff',
            'circuit_open',
            'never_synced',
          ]).toContain(v.kind);
          return true;
        },
      ),
    );
  });

  it('offline state always reports offline kind', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        fc.option(fc.integer({ min: 0, max: 10_000_000_000_000 })),
        (failures, appActive, lastSync) => {
          const v = presentSyncStatus(
            {
              online: false,
              appActive,
              lastSyncAtMs: lastSync,
              lastOutcome: null,
              consecutiveTransportFailures: failures,
            },
            1_700_000_000_000,
          );
          expect(v.kind).toBe('offline');
          return true;
        },
      ),
    );
  });
});

import { decideSyncSchedule } from '../src/sync/sync-scheduler-policy.js';

describe('@fleet/driver-app - presenter <-> scheduler coherence', () => {
  it('offline state: scheduler skips offline AND presenter shows offline', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'app_foreground',
          'timer_tick',
          'push_wake',
          'manual_retry',
          'pending_action_added' as const,
        ),
        fc.boolean(),
        fc.integer({ min: 0, max: 100 }),
        (trigger, appActive, failures) => {
          const state = {
            online: false,
            appActive,
            lastSyncAtMs: null,
            lastOutcome: null,
            consecutiveTransportFailures: failures,
          };
          const decision = decideSyncSchedule(state, trigger, 1_700_000_000_000, {
            random: () => 0.5,
          });
          const view = presentSyncStatus(state, 1_700_000_000_000);
          if (decision.action === 'skip' && decision.reason === 'offline') {
            expect(view.kind).toBe('offline');
          }
          return true;
        },
      ),
    );
  });

  it('circuit_open in scheduler implies circuit_open in presenter', () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 50 }), (failures) => {
        const state = {
          online: true,
          appActive: true,
          lastSyncAtMs: 1_700_000_000_000 - 1_000,
          lastOutcome: 'last_transport_failure' as const,
          consecutiveTransportFailures: failures,
        };
        const decision = decideSyncSchedule(state, 'timer_tick', 1_700_000_000_000, {
          random: () => 0.5,
        });
        const view = presentSyncStatus(state, 1_700_000_000_000);
        if (decision.action === 'defer' && decision.reason === 'circuit_breaker') {
          expect(view.kind).toBe('circuit_open');
        }
        return true;
      }),
    );
  });
});

describe('@fleet/driver-app - presentSyncStatus mutation-hardening labels', () => {
  it('offline view: label is exactly "Offline" and secondary is exactly "Will sync when connection returns"', () => {
    const v = presentSyncStatus(s({ online: false }), NOW);
    expect(v).toEqual({
      kind: 'offline',
      label: 'Offline',
      secondary: 'Will sync when connection returns',
    });
  });

  it('app_inactive view: label is exactly "Paused" and secondary is exactly "Open the app to sync"', () => {
    const v = presentSyncStatus(s({ appActive: false }), NOW);
    expect(v).toEqual({ kind: 'app_inactive', label: 'Paused', secondary: 'Open the app to sync' });
  });

  it('circuit_open view: label is exactly "Sync paused"', () => {
    const v = presentSyncStatus(
      s({ consecutiveTransportFailures: 5, lastOutcome: 'last_transport_failure' }),
      NOW,
    );
    expect(v.label).toBe('Sync paused');
  });

  it('backoff view: label is exactly "Retrying..."', () => {
    const v = presentSyncStatus(
      s({ consecutiveTransportFailures: 2, lastOutcome: 'last_transport_failure' }),
      NOW,
    );
    expect(v.label).toBe('Retrying...');
  });

  it('never_synced view: label is exactly "Not yet synced" and secondary is exactly "Sync will start automatically"', () => {
    const v = presentSyncStatus(s(), NOW);
    expect(v).toEqual({
      kind: 'never_synced',
      label: 'Not yet synced',
      secondary: 'Sync will start automatically',
    });
  });

  it('just-synced view: label is exactly "All caught up" and secondary is exactly "Just synced"', () => {
    const v = presentSyncStatus(s({ lastSyncAtMs: NOW - 30_000, lastOutcome: 'last_idle' }), NOW);
    expect(v).toEqual({ kind: 'idle', label: 'All caught up', secondary: 'Just synced' });
  });

  it('older-sync idle view: label is exactly "All caught up" and secondary uses "Synced <rel> ago"', () => {
    const v = presentSyncStatus(
      s({ lastSyncAtMs: NOW - 3 * 60_000, lastOutcome: 'last_idle' }),
      NOW,
    );
    expect(v.label).toBe('All caught up');
    expect(v.secondary).toBe('Synced 3m ago');
  });

  it('formatRelative: at exactly 60 minutes, transitions to hours (kills minutes < 60 -> minutes <= 60 mutant)', () => {
    // 60 minutes: original `minutes < 60` is false → goes to hours = 1h.
    // Mutated `minutes <= 60` is true → returns `60m`. Different output.
    const v = presentSyncStatus(
      s({ lastSyncAtMs: NOW - 60 * 60_000, lastOutcome: 'last_idle' }),
      NOW,
    );
    expect(v.secondary).toBe('Synced 1h ago');
  });

  it('formatRelative: at 59 minutes, still shows minutes (boundary on the under side)', () => {
    const v = presentSyncStatus(
      s({ lastSyncAtMs: NOW - 59 * 60_000, lastOutcome: 'last_idle' }),
      NOW,
    );
    expect(v.secondary).toBe('Synced 59m ago');
  });

  it('formatRelative: at exactly 24 hours, transitions to days (kills hours < 24 -> hours <= 24 mutant)', () => {
    const v = presentSyncStatus(
      s({ lastSyncAtMs: NOW - 24 * 60 * 60_000, lastOutcome: 'last_idle' }),
      NOW,
    );
    expect(v.secondary).toBe('Synced 1d ago');
  });

  it('formatRelative: at 23 hours, still shows hours', () => {
    const v = presentSyncStatus(
      s({ lastSyncAtMs: NOW - 23 * 60 * 60_000, lastOutcome: 'last_idle' }),
      NOW,
    );
    expect(v.secondary).toBe('Synced 23h ago');
  });
});
