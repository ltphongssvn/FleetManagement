// apps/driver-app/test/sync-status-presenter.test.ts
import { describe, it, expect } from 'vitest';
import { presentSyncStatus, SYNC_STATUS_PRESENTER_VERSION } from '../src/sync/sync-status-presenter.js';
import type { SyncSchedulerState } from '../src/sync/sync-scheduler-policy.js';

const NOW = 1_700_000_000_000;

function s(o: Partial<SyncSchedulerState> = {}): SyncSchedulerState {
  return {
    online: true, appActive: true, lastSyncAtMs: null, lastOutcome: null,
    consecutiveTransportFailures: 0, ...o,
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
    const v = presentSyncStatus(s({ consecutiveTransportFailures: 5, lastOutcome: 'last_transport_failure' }), NOW);
    expect(v.kind).toBe('circuit_open');
    expect(v.secondary).toContain('5 failed');
  });

  it('shows backoff when transport failed but under threshold', () => {
    const v = presentSyncStatus(s({ consecutiveTransportFailures: 2, lastOutcome: 'last_transport_failure' }), NOW);
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
    const v = presentSyncStatus(s({ lastSyncAtMs: NOW - 5 * 60_000, lastOutcome: 'last_idle' }), NOW);
    expect(v.kind).toBe('idle');
    expect(v.secondary).toBe('Synced 5m ago');
  });


  it('rolls over to "1m ago" at exact 60_000ms boundary (#524)', () => {
    const v = presentSyncStatus(s({ lastSyncAtMs: NOW - 60_000, lastOutcome: 'last_idle' }), NOW);
    expect(v.secondary).toBe('Synced 1m ago');
  });

  it('rolls over to hours past 60m', () => {
    const v = presentSyncStatus(s({ lastSyncAtMs: NOW - 2 * 60 * 60_000, lastOutcome: 'last_idle' }), NOW);
    expect(v.secondary).toBe('Synced 2h ago');
  });

  it('rolls over to days past 24h (#527)', () => {
    const v = presentSyncStatus(s({ lastSyncAtMs: NOW - 2 * 24 * 60 * 60_000, lastOutcome: 'last_idle' }), NOW);
    expect(v.secondary).toBe('Synced 2d ago');
  });
  it('exports stable version', () => {
    expect(SYNC_STATUS_PRESENTER_VERSION).toBe('sync-status-v1');
  });
});
