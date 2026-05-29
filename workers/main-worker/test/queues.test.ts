// workers/main-worker/test/queues.test.ts
// TDD: verify queue registry matches Frozen Stack PDF spec.
import { describe, it, expect } from 'vitest';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from '../src/index.js';

describe('@fleet/main-worker — queue registry', () => {
  it('should define exactly 11 queues per PDF spec', () => {
    expect(QUEUE_NAMES).toHaveLength(11);
  });

  it('should include all PDF-mandated queue names', () => {
    const expected = [
      'outbox',
      'outbox-dead-letter',
      'projections',
      'intake',
      'reaper',
      'erp',
      'reminders',
      'shadow-cleanup',
      'arrival-hint-expiry',
      'bootstrap-reaper',
      'bootstrap-generator',
    ];
    for (const q of expected) {
      expect(QUEUE_NAMES).toContain(q);
    }
  });

  it('should enforce bootstrap-reaper concurrency=1 per PDF', () => {
    expect(QUEUE_CONCURRENCY['bootstrap-reaper']).toBe(1);
  });

  it('should enforce bootstrap-generator concurrency=2 per PDF', () => {
    expect(QUEUE_CONCURRENCY['bootstrap-generator']).toBe(2);
  });

  it('should enforce outbox-dead-letter concurrency=1 (manual requeue path)', () => {
    expect(QUEUE_CONCURRENCY['outbox-dead-letter']).toBe(1);
  });

  it('should have a concurrency entry for every queue', () => {
    for (const q of QUEUE_NAMES) {
      expect(QUEUE_CONCURRENCY[q]).toBeGreaterThan(0);
    }
  });
});
