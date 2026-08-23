// apps/api/test/alert-lag-monitor.service.test.ts
// S6a (T12 driver-order-alerts) -- outside-in strict TDD, RED first.
//
// The driver-alert pipeline can now fail SILENTLY in production: an alert
// outbox row that dead-letters (permanent -- a driver definitely will not be
// alerted) or that stays pending/failed past a threshold (stuck -- relay,
// queue, or consumer broke) produces no visible signal. A driver missing a
// 4AM job is the business-critical failure this monitor exists to page on.
//
// Sibling of IntakeLagMonitorService: watches pipeline OUTCOME (the outbox for
// aggregateType=driver_alert). Sentry mocked via vi.hoisted + vi.mock (the
// established break-glass idiom -- vi.spyOn fails on an ESM module namespace);
// repo and clock injected (deterministic-seam pattern).
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockCaptureEvent, capturedEvents } = vi.hoisted(() => {
  const capturedEvents: unknown[] = [];
  return {
    capturedEvents,
    mockCaptureEvent: vi.fn((e: unknown) => {
      capturedEvents.push(e);
      return 'evt-id';
    }),
  };
});
vi.mock('@sentry/nestjs', () => ({ captureEvent: mockCaptureEvent }));
import {
  AlertLagMonitorService,
  type AlertLagRepo,
  type AlertLagSnapshot,
} from '../src/manifest/alert-lag-monitor.service.js';

const T0 = new Date('2026-07-20T04:00:00.000Z').getTime();
const MIN = 60_000;

function repoWith(snapshot: AlertLagSnapshot | null): AlertLagRepo {
  return { snapshot: vi.fn().mockResolvedValue(snapshot) };
}

describe('@fleet/api - AlertLagMonitorService', () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    mockCaptureEvent.mockClear();
  });

  it('stays silent when there are no driver_alert outbox problems', async () => {
    const m = new AlertLagMonitorService(repoWith(null), 15, () => T0);
    await m.checkOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('pages FATAL immediately on a dead-lettered alert (permanent loss, any age)', async () => {
    const snap: AlertLagSnapshot = {
      deadLetterCount: 1,
      oldestPendingId: null,
      oldestPendingCreatedAt: null,
      pendingCount: 0,
    };
    const m = new AlertLagMonitorService(repoWith(snap), 15, () => T0);
    await m.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    const evt = capturedEvents[0] as { level?: string; fingerprint?: string[] };
    expect(evt.level).toBe('fatal');
    expect(evt.fingerprint).toEqual(['driver-alert-pipeline-stalled']);
  });

  it('pages FATAL when the oldest pending alert exceeds the threshold', async () => {
    const snap: AlertLagSnapshot = {
      deadLetterCount: 0,
      oldestPendingId: 'ob-1',
      oldestPendingCreatedAt: new Date(T0 - 20 * MIN),
      pendingCount: 3,
    };
    const m = new AlertLagMonitorService(repoWith(snap), 15, () => T0);
    await m.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    expect((capturedEvents[0] as { level?: string }).level).toBe('fatal');
  });

  it('stays silent when the oldest pending alert is within the threshold', async () => {
    const snap: AlertLagSnapshot = {
      deadLetterCount: 0,
      oldestPendingId: 'ob-2',
      oldestPendingCreatedAt: new Date(T0 - 5 * MIN),
      pendingCount: 1,
    };
    const m = new AlertLagMonitorService(repoWith(snap), 15, () => T0);
    await m.checkOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('fires ONCE per episode, not once per tick, while the stall persists', async () => {
    const snap: AlertLagSnapshot = {
      deadLetterCount: 2,
      oldestPendingId: null,
      oldestPendingCreatedAt: null,
      pendingCount: 0,
    };
    const m = new AlertLagMonitorService(repoWith(snap), 15, () => T0);
    await m.checkOnce();
    await m.checkOnce();
    await m.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
  });

  it('re-arms after recovery so a NEW stall pages again', async () => {
    const bad: AlertLagSnapshot = {
      deadLetterCount: 1,
      oldestPendingId: null,
      oldestPendingCreatedAt: null,
      pendingCount: 0,
    };
    const good: AlertLagSnapshot = {
      deadLetterCount: 0,
      oldestPendingId: null,
      oldestPendingCreatedAt: null,
      pendingCount: 0,
    };
    let current: AlertLagSnapshot = bad;
    const repo: AlertLagRepo = {
      snapshot: vi.fn().mockImplementation(() => Promise.resolve(current)),
    };
    const m = new AlertLagMonitorService(repo, 15, () => T0);
    await m.checkOnce();
    current = good;
    await m.checkOnce();
    current = bad;
    await m.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(2);
  });

  it('includes the backlog count and oldest age in the event extra', async () => {
    const snap: AlertLagSnapshot = {
      deadLetterCount: 0,
      oldestPendingId: 'ob-9',
      oldestPendingCreatedAt: new Date(T0 - 30 * MIN),
      pendingCount: 4,
    };
    const m = new AlertLagMonitorService(repoWith(snap), 15, () => T0);
    await m.checkOnce();
    const evt = capturedEvents[0] as {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    };
    expect(evt.tags?.['pipeline_event']).toBe('driver_alert_stalled');
    expect(evt.extra?.['pendingCount']).toBe(4);
    expect(evt.extra?.['oldestAgeMinutes']).toBe(30);
  });
});
