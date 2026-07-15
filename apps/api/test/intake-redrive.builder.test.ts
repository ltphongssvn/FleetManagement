// apps/api/test/intake-redrive.builder.test.ts
// RED (phieu-photo-visibility arc, slice F): pure builder for the intake
// backlog redrive. 65 manifests sat in verifying because every worker
// callback 401ed (expired static token, Jun-24 incident); the sanctioned
// repair is compensating manifest_intake.requested events THROUGH the
// pipeline (outbox -> relay -> BullMQ -> worker -> finalizeIntake), never
// hand-patching manifest state. The builder must reproduce the producer
// contract EXACTLY: envelope {aggregateType,eventType,serverSeq} + a body
// that strict-parses with IntakeJobDataWireSchema (@fleet/sync-protocol) --
// proven here by parsing the built body with the SSOT schema itself.
import { describe, it, expect } from 'vitest';
import { IntakeJobDataWireSchema, OUTBOX_QUEUES } from '@fleet/sync-protocol';
import { buildIntakeRedriveOutboxValues } from '../src/manifest/intake-redrive.builder.js';

const SENTINEL = '00000000-0000-0000-0000-000000000000';
const CANDIDATE = {
  companyId: SENTINEL,
  businessUnitId: SENTINEL,
  depotId: SENTINEL,
  legalEntityId: SENTINEL,
  manifestId: 'afd08f3c-d71f-47cf-9086-31c1235069a6',
  uploadSessionId: '4dad0a54-7e9e-4c2e-9420-09e3548bfa27',
  s3Key: 'manifests/00000000-0000-0000-0000-000000000000/afd08f3c/x.jpg',
  s3Bucket: 'fleet-pilot-artifacts',
  contentType: 'image/jpeg',
  expectedSizeBytes: 123456,
  actualSizeBytes: null,
  contentHash: null,
};

describe('buildIntakeRedriveOutboxValues', () => {
  it('builds the exact producer contract: envelope + strict-schema-valid body', () => {
    const values = buildIntakeRedriveOutboxValues(CANDIDATE, 4242n);
    expect(values.queueName).toBe(OUTBOX_QUEUES.INTAKE);
    expect(values.companyId).toBe(SENTINEL);
    expect(values.legalEntityId).toBe(SENTINEL);
    const payload = values.payload;
    expect(payload['aggregateType']).toBe('manifest_intake');
    expect(payload['eventType']).toBe('manifest_intake.requested');
    expect(payload['serverSeq']).toBe('4242');
    const envelopeKeys = ['aggregateType', 'eventType', 'serverSeq'];
    const body = Object.fromEntries(
      Object.entries(payload).filter(([k]) => !envelopeKeys.includes(k)),
    );
    const parsed = IntakeJobDataWireSchema.parse(body);
    expect(parsed.manifestId).toBe(CANDIDATE.manifestId);
    expect(parsed.s3Bucket).toBe('fleet-pilot-artifacts');
    expect(parsed.actualContentType).toBeNull();
    expect(parsed.computedHash).toBeNull();
    expect(parsed.virusScanClean).toBeNull();
    expect(parsed.expectedSizeBytes).toBe(123456);
    expect(parsed.maxSizeBytes).toBeGreaterThan(0);
  });

  it('falls back to actualSizeBytes when expectedSizeBytes is null (producer parity)', () => {
    const values = buildIntakeRedriveOutboxValues(
      { ...CANDIDATE, expectedSizeBytes: null, actualSizeBytes: 777 },
      1n,
    );
    const payload = values.payload;
    expect(payload['expectedSizeBytes']).toBe(777);
  });

  it('carries providedHash from the session contentHash', () => {
    const values = buildIntakeRedriveOutboxValues({ ...CANDIDATE, contentHash: 'h-abc' }, 2n);
    const payload = values.payload;
    expect(payload['providedHash']).toBe('h-abc');
  });

  it('throws on a session missing s3Key/s3Bucket instead of emitting an invalid job', () => {
    expect(() => buildIntakeRedriveOutboxValues({ ...CANDIDATE, s3Key: null }, 3n)).toThrow();
    expect(() => buildIntakeRedriveOutboxValues({ ...CANDIDATE, s3Bucket: null }, 3n)).toThrow();
  });

  it('throws when both size fields are null (schema requires positive int)', () => {
    expect(() =>
      buildIntakeRedriveOutboxValues({ ...CANDIDATE, expectedSizeBytes: null, actualSizeBytes: null }, 5n),
    ).toThrow();
  });
});
