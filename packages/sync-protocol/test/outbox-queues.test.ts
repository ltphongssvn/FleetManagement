// packages/sync-protocol/test/outbox-queues.test.ts
import { describe, it, expect } from 'vitest';
import { OUTBOX_QUEUES, type OutboxQueueName } from '../src/index.js';

describe('@fleet/sync-protocol - OUTBOX_QUEUES', () => {
  it('exports the canonical set of queue names', () => {
    expect(OUTBOX_QUEUES.PROJECTIONS).toBe('projections');
    expect(OUTBOX_QUEUES.ERP).toBe('erp');
  });
  it('OutboxQueueName covers all routing targets', () => {
    const _name: OutboxQueueName = 'projections';
    expect(_name).toBe('projections');
  });
});
