// workers/main-worker/test/queue-router.test.ts
import { describe, it, expect } from 'vitest';
import { routeJob, createBullDeadLetterSink, type DeadLetterSink, type DeadLetterEntry } from '../src/queue-router.js';

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

describe('@fleet/main-worker - createBullDeadLetterSink', () => {
  it('publishes dead-letter entry via queue.add with non-removable retention', async () => {
    const addCalls: { name: string; data: unknown; opts: unknown }[] = [];
    const fakeQueue = {
      add: (name: string, data: unknown, opts: unknown) => {
        addCalls.push({ name, data, opts });
        return Promise.resolve({ id: 'job1' });
      },
    };
    const sink = createBullDeadLetterSink(fakeQueue as never);
    await sink.send({
      originalQueue: 'intake',
      jobId: 'j1',
      reason: 'schema_validation_failed',
      errorIssues: [{ path: ['x'], message: 'bad' }],
      originalPayload: { foo: 1 },
      receivedAt: '2026-04-29T00:00:00.000Z',
    });
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]?.name).toBe('schema_validation_failed');
    expect(addCalls[0]?.opts).toEqual({ removeOnComplete: false, removeOnFail: false });
  });
});

describe('@fleet/main-worker - queue-router non-Zod errors', () => {
  it('rethrows non-Zod errors raised by deadLetters.send (infra failure path)', async () => {
    const throwingSink: DeadLetterSink = {
      send: () => Promise.reject(new Error('non-zod failure')),
    };
    await expect(
      routeJob('intake', { id: 'jX', data: { manifestId: 'not-uuid' } }, throwingSink),
    ).rejects.toThrow('non-zod failure');
  });
});

describe('@fleet/main-worker - queue-router non-Zod throw inside try block', () => {
  it('rethrows non-Zod errors raised inside the parse/process block', async () => {
    // Pass a non-plain-object data that satisfies zod but causes processor work to throw.
    // Easiest: pass a Proxy that throws when zod walks it. But zod parse will throw a ZodError.
    // Cleanest path: monkey-patch IntakeJobDataSchema.parse via a custom name that the router
    // doesn't handle but throws a non-Zod error. Use a queue name that *would* be intake,
    // and make data a frozen object with a getter that throws non-Zod.
    const badData = new Proxy({}, {
      get() { throw new TypeError('synthetic non-zod failure'); },
    });
    const { sink } = (() => {
      return { sink: { send: () => Promise.resolve() } };
    })();
    await expect(
      routeJob('intake', { id: 'jY', data: badData as never }, sink as never),
    ).rejects.toThrow();
  });
});

describe('@fleet/main-worker - queue-router rejected-decision summary branches', () => {
  it('summary includes rejectionCode when intake processor rejects (not zod, valid schema)', async () => {
    const rejectedIntakeJob = { ...validIntakeJob, virusScanClean: false };
    const { sink } = makeSink();
    const result = await routeJob('intake', { id: 'jR1', data: rejectedIntakeJob }, sink);
    expect(result.handled).toBe(true);
    expect(result.deadLettered).toBe(false);
    expect(result.summary).toContain('rejected:virus_detected');
  });

  it('summary includes rejectionCode when erp processor rejects (not zod, valid schema)', async () => {
    const rejectedErpJob = {
      ...validErpJob,
      mapping: { customerExternalId: null, jobCodeExternalId: 'EXT-J-1' },
    };
    const { sink } = makeSink();
    const result = await routeJob('erp', { id: 'jR2', data: rejectedErpJob }, sink);
    expect(result.handled).toBe(true);
    expect(result.summary).toContain('rejected:unknown_customer');
  });

  it('falls back to null jobId when job.id is undefined', async () => {
    const { sink, sent } = makeSink();
    await routeJob('intake', { data: { manifestId: 'not-uuid' } } as never, sink);
    const entry = sent[0]; if (!entry) throw new Error('expected entry');
    expect(entry.jobId).toBeNull();
  });
});

describe('@fleet/main-worker - queue-router with optional ports', () => {
  it('invokes intakeCallback.finalize on accepted intake', async () => {
    const { sink } = makeSink();
    const calls: unknown[] = [];
    const cb = { finalize: (input: unknown) => { calls.push(input); return Promise.resolve(); } };
    const result = await routeJob('intake', { id: 'jc1', data: validIntakeJob }, sink, cb);
    expect(result.handled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ uploadSessionId: validIntakeJob.uploadSessionId, accepted: true });
  });

  it('invokes intakeCallback.finalize with rejection on rejected intake', async () => {
    const { sink } = makeSink();
    const calls: unknown[] = [];
    const cb = { finalize: (input: unknown) => { calls.push(input); return Promise.resolve(); } };
    await routeJob('intake', { id: 'jc2', data: { ...validIntakeJob, virusScanClean: false } }, sink, cb);
    expect(calls[0]).toMatchObject({ accepted: false });
  });

  it('routes erp via sendErpInvoice when erpClient provided (sent path)', async () => {
    const { sink } = makeSink();
    const erp = { sendInvoice: () => Promise.resolve({ externalInvoiceId: 'EXT-77' }) };
    const result = await routeJob('erp', { id: 'jc3', data: validErpJob }, sink, undefined, erp);
    expect(result.summary).toContain('sent externalInvoiceId=EXT-77');
  });

  it('routes erp via sendErpInvoice when erpClient provided (rejected path)', async () => {
    const { sink } = makeSink();
    const erp = { sendInvoice: () => Promise.reject(new Error('unused')) };
    const rejected = { ...validErpJob, mapping: { customerExternalId: null, jobCodeExternalId: 'EXT-J-1' } };
    const result = await routeJob('erp', { id: 'jc4', data: rejected }, sink, undefined, erp);
    expect(result.summary).toContain('rejected:');
  });

  it('rethrows when erpClient.sendInvoice fails (BullMQ retries infra failure)', async () => {
    const { sink } = makeSink();
    const erp = { sendInvoice: () => Promise.reject(new Error('erp 503')) };
    await expect(
      routeJob('erp', { id: 'jc5', data: validErpJob }, sink, undefined, erp),
    ).rejects.toThrow('erp 503');
  });
});
