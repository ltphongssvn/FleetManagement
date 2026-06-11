// packages/sync-protocol/test/order-timeline-contract.test.ts
// Contract test: the timeline schema accepts every event shape, rejects unknown
// event types, rejects loose extra keys (strict), and preserves legacy-null
// boundStopSequence semantics.
import { describe, it, expect } from 'vitest';
import { OrderTimelineSchema, OrderTimelineEventSchema } from '../src/order-timeline-contract.js';

const U = '11111111-aaaa-4aaa-8aaa-111111111111';
const T = '2026-06-11T13:34:58.000Z';

describe('@fleet/sync-protocol - order-timeline contract', () => {
  it('accepts a full happy-path timeline with all event types', () => {
    const parsed = OrderTimelineSchema.parse({
      externalRef: 'XTT.06-006',
      transportOrderId: U,
      events: [
        { eventType: 'order_created', at: T },
        { eventType: 'run_created', at: T, roadRunId: U },
        { eventType: 'run_started', at: T, roadRunId: U },
        { eventType: 'stop_arrived', at: T, stopSequence: 1, stopType: 'pickup' },
        { eventType: 'manifest_negotiated', at: T, manifestId: U, boundStopSequence: 1 },
        { eventType: 'manifest_committed', at: T, manifestId: U, boundStopSequence: 1 },
        { eventType: 'stop_departed', at: T, stopSequence: 1, stopType: 'pickup' },
        { eventType: 'run_completed', at: T, roadRunId: U },
      ],
    });
    expect(parsed.events).toHaveLength(8);
  });
  it('accepts legacy-null boundStopSequence (old-client back-compat surfaced honestly)', () => {
    const e = OrderTimelineEventSchema.parse(
      { eventType: 'manifest_committed', at: T, manifestId: U, boundStopSequence: null });
    expect(e.eventType === 'manifest_committed' && e.boundStopSequence).toBeNull();
  });
  it('accepts order_cancelled and manifest_rejected with nullable detail fields', () => {
    expect(OrderTimelineEventSchema.parse(
      { eventType: 'order_cancelled', at: T, reason: 'customer', note: null }).eventType).toBe('order_cancelled');
    expect(OrderTimelineEventSchema.parse(
      { eventType: 'manifest_rejected', at: T, manifestId: U, boundStopSequence: null, reasonText: null }).eventType).toBe('manifest_rejected');
  });
  it('rejects unknown event types', () => {
    expect(() => OrderTimelineEventSchema.parse({ eventType: 'order_teleported', at: T })).toThrow();
  });
  it('rejects extra keys (strict objects guard contract drift)', () => {
    expect(() => OrderTimelineEventSchema.parse(
      { eventType: 'order_created', at: T, surprise: 1 })).toThrow();
    expect(() => OrderTimelineSchema.parse(
      { externalRef: 'X', transportOrderId: U, events: [], extra: true })).toThrow();
  });
  it('rejects non-datetime at and non-positive stopSequence', () => {
    expect(() => OrderTimelineEventSchema.parse({ eventType: 'order_created', at: 'yesterday' })).toThrow();
    expect(() => OrderTimelineEventSchema.parse(
      { eventType: 'stop_arrived', at: T, stopSequence: 0, stopType: 'pickup' })).toThrow();
  });
});
