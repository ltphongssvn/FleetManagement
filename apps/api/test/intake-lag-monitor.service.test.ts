// apps/api/test/intake-lag-monitor.service.test.ts
// RED (phieu-photo-visibility arc, slice G): the regression guard that makes
// the Jun-24 failure mode LOUD. The incident ran silent for 17 days because
// nothing watched pipeline OUTCOMES: intake jobs failed 401 and manifests
// piled up in verifying with zero alerts. checkOnce() reads the oldest
// verifying manifest; when its age crosses the threshold it emits ONE Sentry
// fatal per stall episode (fingerprint intake-pipeline-stalled), re-arming
// only after recovery -- so a credential break pages within minutes, not
// weeks. Sentry mocked via vi.hoisted + vi.mock (break-glass idiom); repo and
// clock injected (deterministic-seam pattern).
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockCaptureEvent, capturedEvents } = vi.hoisted(() => {
  const capturedEvents: unknown[] = [];
  return {
    capturedEvents,
    mockCaptureEvent: vi.fn((e: unknown) => { capturedEvents.push(e); return 'evt-id'; }),
  };
});
vi.mock('@sentry/nestjs', () => ({ captureEvent: mockCaptureEvent }));
import { IntakeLagMonitorService, type IntakeLagRepo } from '../src/manifest/intake-lag-monitor.service.js';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
function repoWith(row: { manifestId: string; createdAt: Date; verifyingCount: number } | null): IntakeLagRepo {
  return { oldestVerifying: vi.fn().mockResolvedValue(row) };
}

describe('@fleet/api - IntakeLagMonitorService', () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    mockCaptureEvent.mockClear();
  });

  it('does nothing when no manifests are verifying', async () => {
    const svc = new IntakeLagMonitorService(repoWith(null), 30, () => T0);
    await svc.checkOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('does nothing while the oldest verifying manifest is younger than the threshold', async () => {
    const repo = repoWith({ manifestId: 'm-1', createdAt: new Date(T0 - 29 * MIN), verifyingCount: 3 });
    const svc = new IntakeLagMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  it('emits ONE Sentry fatal with fingerprint + diagnostics when the threshold is crossed', async () => {
    const repo = repoWith({ manifestId: 'm-old', createdAt: new Date(T0 - 45 * MIN), verifyingCount: 66 });
    const svc = new IntakeLagMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    const emitted = capturedEvents[0] as {
      level?: string;
      fingerprint?: string[];
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    };
    expect(emitted.level).toBe('fatal');
    expect(emitted.fingerprint).toEqual(['intake-pipeline-stalled']);
    expect(emitted.tags?.['pipeline_event']).toBe('intake_stalled');
    expect(emitted.extra?.['oldestManifestId']).toBe('m-old');
    expect(emitted.extra?.['verifyingCount']).toBe(66);
    expect(emitted.extra?.['oldestAgeMinutes']).toBe(45);
    expect(emitted.extra?.['thresholdMinutes']).toBe(30);
  });

  it('pages only once per stall episode (no re-alert while still stalled)', async () => {
    const repo = repoWith({ manifestId: 'm-old', createdAt: new Date(T0 - 45 * MIN), verifyingCount: 5 });
    const svc = new IntakeLagMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    await svc.checkOnce();
    await svc.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
  });

  it('re-arms after recovery: stall -> healthy -> stall pages twice total', async () => {
    let row: { manifestId: string; createdAt: Date; verifyingCount: number } | null = {
      manifestId: 'm-1',
      createdAt: new Date(T0 - 45 * MIN),
      verifyingCount: 2,
    };
    const repo: IntakeLagRepo = { oldestVerifying: vi.fn().mockImplementation(() => Promise.resolve(row)) };
    const svc = new IntakeLagMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    row = null;
    await svc.checkOnce();
    row = { manifestId: 'm-2', createdAt: new Date(T0 - 90 * MIN), verifyingCount: 1 };
    await svc.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(2);
  });

  it('a young backlog after a stall also re-arms the episode', async () => {
    let row = { manifestId: 'm-1', createdAt: new Date(T0 - 45 * MIN), verifyingCount: 2 };
    const repo: IntakeLagRepo = { oldestVerifying: vi.fn().mockImplementation(() => Promise.resolve(row)) };
    const svc = new IntakeLagMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    row = { manifestId: 'm-9', createdAt: new Date(T0 - 1 * MIN), verifyingCount: 1 };
    await svc.checkOnce();
    row = { manifestId: 'm-9', createdAt: new Date(T0 - 40 * MIN), verifyingCount: 1 };
    await svc.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(2);
  });

  it('exactly at the threshold does not page (strictly greater crosses)', async () => {
    const repo = repoWith({ manifestId: 'm-1', createdAt: new Date(T0 - 30 * MIN), verifyingCount: 1 });
    const svc = new IntakeLagMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });
});
