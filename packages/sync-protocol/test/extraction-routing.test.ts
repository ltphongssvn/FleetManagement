// packages/sync-protocol/test/extraction-routing.test.ts
// RED for phieu-can net-weight extraction routing: outbox must dispatch
// manifest_extraction.requested -> 'extraction' queue (additive rule + queue).
import { describe, expect, it } from 'vitest';
import { OUTBOX_QUEUES, routeOutboxRow } from '../src/outbox-routing.js';

describe('extraction outbox routing (additive)', () => {
  it('exposes OUTBOX_QUEUES.EXTRACTION = extraction', () => {
    expect(OUTBOX_QUEUES.EXTRACTION).toBe('extraction');
  });

  it('routes manifest_extraction.requested to the extraction queue', () => {
    const d = routeOutboxRow({ aggregateType: 'manifest_extraction', eventType: 'manifest_extraction.requested' });
    expect(d.accepted).toBe(true);
    if (d.accepted) expect(d.queueName).toBe('extraction');
  });

  it('rejects unknown manifest_extraction event types', () => {
    const d = routeOutboxRow({ aggregateType: 'manifest_extraction', eventType: 'manifest_extraction.bogus' });
    expect(d.accepted).toBe(false);
    if (!d.accepted) expect(d.rejectionCode).toBe('unknown_event_type');
  });

  it('keeps existing intake routing intact (regression)', () => {
    const d = routeOutboxRow({ aggregateType: 'manifest_intake', eventType: 'manifest_intake.requested' });
    expect(d.accepted).toBe(true);
    if (d.accepted) expect(d.queueName).toBe('intake');
  });
});
