// workers/main-worker/test/queue-router.test.ts
import { describe, it, expect } from 'vitest';
import { routeJob, type DeadLetterSink, type DeadLetterEntry } from '../src/queue-router.js';

function makeSink(): { sink: DeadLetterSink; sent: DeadLetterEntry[] } {
  const sent: DeadLetterEntry[] = [];
  return {
    sent,
    sink: { send: (entry) => { sent.push(entry); return Promise.resolve(); } },
  };
}

const validIntakeJob = {
  manifestId: '11111111-1111-4111-8111-111111111111',
  uploadSessionId: '22222222-2222-4222-8222-222222222222',
  expectedContentType: 'image/jpeg',
  expectedSizeBytes: 1_500_000,
  maxSizeBytes: 5_000_000,
  actualContentType: 'image/jpeg',
  actualSizeBytes: 1_400_000,
  providedHash: 'a'.repeat(64),
  computedHash: 'a'.repeat(64),
  virusScanClean: true,
};

const validErpJob = {
  payload: {
    manifestCorrelationId: '11111111-1111-4111-8111-111111111111',
    transportOrderId: '22222222-2222-4222-8222-222222222222',
    internalCustomerId: '33333333-3333-4333-8333-333333333333',
    internalJobCode: 'JOB-1',
    amountCents: 250_000,
    currency: 'USD',
    erpSystem: 'pilot-erp',
  },
  mapping: { customerExternalId: 'EXT-1', jobCodeExternalId: 'EXT-J-1' },
};

describe('@fleet/main-worker - queue-router', () => {
  it('routes valid intake job to IntakeProcessor', async () => {
    const { sink, sent } = makeSink();
    const result = await routeJob('intake', { id: 'j1', data: validIntakeJob }, sink);
    expect(result.handled).toBe(true);
    expect(result.deadLettered).toBe(false);
    expect(result.summary).toContain('accepted');
    expect(sent).toHaveLength(0);
  });

  it('routes valid erp job to ErpProcessor', async () => {
    const { sink } = makeSink();
    const result = await routeJob('erp', { id: 'j2', data: validErpJob }, sink);
    expect(result.handled).toBe(true);
    expect(result.summary).toContain('accepted');
  });

  it('dead-letters malformed intake payload (ZodError)', async () => {
    const { sink, sent } = makeSink();
    const result = await routeJob('intake', { id: 'j3', data: { manifestId: 'not-uuid' } }, sink);
    expect(result.deadLettered).toBe(true);
    expect(result.summary).toBe('dead_letter:schema_validation_failed');
    expect(sent).toHaveLength(1);
    const entry = sent[0];
    if (!entry) throw new Error('expected entry');
    expect(entry.originalQueue).toBe('intake');
    expect(entry.reason).toBe('schema_validation_failed');
    expect(entry.jobId).toBe('j3');
  });

  it('dead-letters malformed erp payload (ZodError)', async () => {
    const { sink, sent } = makeSink();
    const result = await routeJob('erp', { id: 'j4', data: { payload: {}, mapping: {} } }, sink);
    expect(result.deadLettered).toBe(true);
    expect(sent).toHaveLength(1);
    const entry = sent[0];
    if (!entry) throw new Error('expected entry');
    expect(entry.originalQueue).toBe('erp');
  });

  it('returns stub for unwired queue without dead-lettering', async () => {
    const { sink, sent } = makeSink();
    const result = await routeJob('reminders', { id: 'j5', data: {} }, sink);
    expect(result.handled).toBe(false);
    expect(result.deadLettered).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('rethrows non-ZodError (infra failures must trigger BullMQ retry)', async () => {
    const throwingSink: DeadLetterSink = {
      send: () => Promise.reject(new Error('redis down')),
    };
    await expect(
      routeJob('intake', { id: 'j6', data: { manifestId: 'not-uuid' } }, throwingSink),
    ).rejects.toThrow('redis down');
  });
});
