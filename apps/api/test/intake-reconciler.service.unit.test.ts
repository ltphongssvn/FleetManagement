// apps/api/test/intake-reconciler.service.unit.test.ts
// Pure unit coverage for IntakeReconcilerService loop branches that the
// integration test cannot reach through the real repo: the
// redriveOnce-returns-false arm (service does NOT increment emitted --
// the optimistic-race-lost path as seen from the service) and the
// episode-flag re-arm on recovery. Stub repo, Sentry mocked, no DB.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockCaptureEvent } = vi.hoisted(() => ({ mockCaptureEvent: vi.fn() }));
vi.mock('@sentry/nestjs', () => ({ captureEvent: mockCaptureEvent }));
import { IntakeReconcilerService } from '../src/manifest/intake-reconciler.service.js';
import type {
  IntakeReconcileRepo,
  IntakeReconcileCandidate,
  IntakeExhaustedSummary,
} from '../src/manifest/intake-reconciler.service.js';
const AFTER = 15;
const MAX = 5;
function candidate(id: string, attempts: number): IntakeReconcileCandidate {
  return {
    companyId: 'c',
    businessUnitId: 'b',
    depotId: 'd',
    legalEntityId: 'l',
    manifestId: id,
    uploadSessionId: 'u',
    s3Key: 'k',
    s3Bucket: 'bk',
    contentType: 'image/jpeg',
    expectedSizeBytes: 1,
    actualSizeBytes: 1,
    contentHash: null,
    createdAt: new Date(),
    attempts,
  };
}
function stubRepo(over: Partial<IntakeReconcileRepo>): IntakeReconcileRepo {
  return {
    findEligible: vi.fn().mockResolvedValue([]),
    redriveOnce: vi.fn().mockResolvedValue(true),
    exhaustedSummary: vi.fn().mockResolvedValue(null),
    ...over,
  };
}
describe('@fleet/api - IntakeReconcilerService loop branches (unit)', () => {
  beforeEach(() => {
    mockCaptureEvent.mockClear();
  });
  it('does NOT count emitted when redriveOnce returns false (race lost)', async () => {
    const repo = stubRepo({
      findEligible: vi.fn().mockResolvedValue([candidate('m1', 0), candidate('m2', 0)]),
      redriveOnce: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    });
    const svc = new IntakeReconcilerService(repo, AFTER, MAX, 25);
    const res = await svc.reconcileOnce();
    expect(res.eligible).toBe(2);
    expect(res.emitted).toBe(1);
    expect(res.exhausted).toBe(0);
  });
  it('fires exactly one fatal per episode and re-arms after recovery', async () => {
    const summary: IntakeExhaustedSummary = {
      count: 2,
      oldestManifestId: 'm9',
      oldestAgeMinutes: 99,
    };
    const exhaustedSummary = vi
      .fn()
      .mockResolvedValueOnce(summary)
      .mockResolvedValueOnce(summary)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);
    const repo = stubRepo({ exhaustedSummary });
    const svc = new IntakeReconcilerService(repo, AFTER, MAX, 25);
    await svc.reconcileOnce();
    await svc.reconcileOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    await svc.reconcileOnce();
    await svc.reconcileOnce();
    expect(mockCaptureEvent).toHaveBeenCalledTimes(2);
  });
});
