// apps/api/test/completion-reconciler-monitor.service.test.ts
// RED (completion-reconciler guard arc, slice S): the PROACTIVE guard that makes
// the stranded-completed-delivery failure mode LOUD. Task 1 (PR #297) built the
// reactive repair (findDeliveredIncompleteRuns + a compensating road_run.completed
// event) after XTT.07-019/020 sat stranded in Dang chay for a day -- delivered
// (all photos committed) but never transitioned to completed because the driver
// client complete-intent window closed before the intake redrive committed the
// manifests. This monitor watches the OUTCOME -- the oldest delivered-but-non-
// terminal run age -- so ANY future recurrence (intake stall, client gap) pages
// within one threshold window regardless of cause. Mirrors IntakeLagMonitorService
// exactly: ONE Sentry fatal per stranded episode (fingerprint
// road-run-completion-stranded), re-arming only after recovery. Sentry mocked via
// vi.hoisted + vi.mock; repo + clock injected (deterministic-seam pattern).
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockCaptureEvent, capturedEvents } = vi.hoisted(() => {
  const capturedEvents: unknown[] = [];
  return {
    capturedEvents,
    mockCaptureEvent: vi.fn((e: unknown) => { capturedEvents.push(e); return 'evt-id'; }),
  };
});
vi.mock('@sentry/nestjs', () => ({ captureEvent: mockCaptureEvent }));
import { CompletionReconcilerMonitorService, type CompletionStrandedRepo } from '../src/maintenance/completion-reconciler-monitor.service.js';
const T0 = 1_800_000_000_000;
const MIN = 60_000;
function repoWith(row: { roadRunId: string; startedAt: Date; strandedCount: number } | null): CompletionStrandedRepo {
  return { oldestStrandedDeliveredRun: vi.fn().mockResolvedValue(row) };
}
describe('@fleet/api - CompletionReconcilerMonitorService', () => {
  beforeEach(() => {
    capturedEvents.length = 0;
    mockCaptureEvent.mockClear();
  });
  it('does nothing when no delivered run is stranded', async () => {
    const svc = new CompletionReconcilerMonitorService(repoWith(null), 30, () => T0);
    await svc.checkOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });
  it('does nothing while the oldest stranded run is younger than the threshold', async () => {
    const repo = repoWith({ roadRunId: 'rr-1', startedAt: new Date(T0 - 29 * MIN), strandedCount: 2 });
    const svc = new CompletionReconcilerMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });
  it('emits ONE Sentry fatal with fingerprint + diagnostics when the threshold is crossed', async () => {
    const repo = repoWith({ roadRunId: 'rr-old', startedAt: new Date(T0 - 45 * MIN), strandedCount: 2 });
    const svc = new CompletionReconcilerMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    const emitted = capturedEvents[0] as {
      level?: string;
      fingerprint?: string[];
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    };
    expect(emitted.level).toBe('fatal');
    expect(emitted.fingerprint).toEqual(['road-run-completion-stranded']);
    expect(emitted.tags?.['pipeline_event']).toBe('completion_stranded');
    expect(emitted.extra?.['oldestRoadRunId']).toBe('rr-old');
    expect(emitted.extra?.['strandedCount']).toBe(2);
    expect(emitted.extra?.['oldestAgeMinutes']).toBe(45);
    expect(emitted.extra?.['thresholdMinutes']).toBe(30);
  });
  it('pages only once per stranded episode (no re-alert while still stranded)', async () => {
    const repo = repoWith({ roadRunId: 'rr-old', startedAt: new Date(T0 - 45 * MIN), strandedCount: 1 });
    const svc = new CompletionReconcilerMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    await svc.checkOnce();
    await svc.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
  });
  it('re-arms after recovery: stranded -> healthy -> stranded pages twice total', async () => {
    let row: { roadRunId: string; startedAt: Date; strandedCount: number } | null = {
      roadRunId: 'rr-1', startedAt: new Date(T0 - 45 * MIN), strandedCount: 2,
    };
    const repo: CompletionStrandedRepo = { oldestStrandedDeliveredRun: vi.fn().mockImplementation(() => Promise.resolve(row)) };
    const svc = new CompletionReconcilerMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    row = null;
    await svc.checkOnce();
    row = { roadRunId: 'rr-2', startedAt: new Date(T0 - 90 * MIN), strandedCount: 1 };
    await svc.checkOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(2);
  });
  it('exactly at the threshold does not page (strictly greater crosses)', async () => {
    const repo = repoWith({ roadRunId: 'rr-1', startedAt: new Date(T0 - 30 * MIN), strandedCount: 1 });
    const svc = new CompletionReconcilerMonitorService(repo, 30, () => T0);
    await svc.checkOnce();
    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });
});
