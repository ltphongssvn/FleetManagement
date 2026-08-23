// workers/main-worker/test/intake-processor.test.ts
import { describe, it, expect } from 'vitest';
import { IntakeProcessor } from '../src/intake/intake-processor.js';
import type { IntakeJobData } from '../src/intake/intake-job.js';
import { IntakeJobDataSchema } from '../src/intake/intake-job.js';
import { INTAKE_POLICY_VERSION } from '../src/intake/intake-policy.js';

const validJob: IntakeJobData = {
  manifestId: '11111111-1111-4111-8111-111111111111',
  uploadSessionId: '22222222-2222-4222-8222-222222222222',
  s3Key: 'manifests/co/m/c.jpg',
  s3Bucket: 'fleet-pilot-artifacts',
  expectedContentType: 'image/jpeg',
  expectedSizeBytes: 1_500_000,
  maxSizeBytes: 5_000_000,
  actualContentType: 'image/jpeg',
  actualSizeBytes: 1_400_000,
  providedHash: 'a'.repeat(64),
  computedHash: 'a'.repeat(64),
  virusScanClean: true,
};

describe('@fleet/main-worker - IntakeProcessor', () => {
  it('processes a valid job and returns accepted decision', () => {
    const processor = new IntakeProcessor();
    const result = processor.process(validJob);
    expect(result.accepted).toBe(true);
    expect(result.policyVersion).toBe(INTAKE_POLICY_VERSION);
  });

  it('rejects when virus scan fails', () => {
    const processor = new IntakeProcessor();
    const result = processor.process({ ...validJob, virusScanClean: false });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.rejectionCode).toBe('virus_detected');
  });

  it('rejects when hash missing for committed-hash payload (fail-closed: domain rejection, not throw)', () => {
    const processor = new IntakeProcessor();
    const result = processor.process({ ...validJob, computedHash: null });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.rejectionCode).toBe('hash_missing');
  });

  it('rejects when virus scan still pending (fail-closed)', () => {
    const processor = new IntakeProcessor();
    const result = processor.process({ ...validJob, virusScanClean: null });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.rejectionCode).toBe('virus_scan_pending');
  });

  it('rejects when actual content missing (S3 object never landed)', () => {
    const processor = new IntakeProcessor();
    const result = processor.process({
      ...validJob,
      actualContentType: null,
      actualSizeBytes: null,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.rejectionCode).toBe('object_missing');
  });
});

describe('@fleet/main-worker - IntakeJobDataSchema (boundary validation)', () => {
  it('parses well-formed payload', () => {
    const parsed = IntakeJobDataSchema.parse(validJob);
    expect(parsed.manifestId).toBe(validJob.manifestId);
  });

  it('rejects payload with non-UUID manifestId', () => {
    expect(() => IntakeJobDataSchema.parse({ ...validJob, manifestId: 'not-a-uuid' })).toThrow();
  });

  it('rejects payload with negative expectedSizeBytes', () => {
    expect(() => IntakeJobDataSchema.parse({ ...validJob, expectedSizeBytes: -1 })).toThrow();
  });

  it('rejects payload missing required field', () => {
    const { virusScanClean: _omit, ...partial } = validJob;
    expect(() => IntakeJobDataSchema.parse(partial)).toThrow();
  });

  it('accepts null hashes and null virusScanClean (fail-closed handled in policy, not schema)', () => {
    const parsed = IntakeJobDataSchema.parse({
      ...validJob,
      providedHash: null,
      computedHash: null,
      virusScanClean: null,
    });
    expect(parsed.virusScanClean).toBeNull();
  });
});
