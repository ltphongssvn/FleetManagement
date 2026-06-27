// packages/sync-protocol/test/order-timeline-contract.test.ts
// Contract test: the timeline schema accepts every event shape, rejects unknown
// event types, rejects loose extra keys (strict), and preserves legacy-null
// boundStopSequence semantics.
//
// order_cancelled.reason lockstep (P0, 2026): the timeline is an EXPAND-only
// AUDIT read contract, and cancellation_reason is a plain varchar(64) at the DB
// (NOT a pgEnum), so the schema keeps reason permissive (string | null) to remain
// able to parse historical rows. To still bind the audit stream to the cancel
// vocabulary WITHOUT importing @fleet/domain (this package is dependency-isolated:
// zod-only, no @fleet/* deps -- same reason ROAD_RUN_STATES is inlined here), we
// assert behaviorally that EVERY canonical cancel-reason value is accepted by the
// order_cancelled event. SSOT is @fleet/domain CANCEL_REASONS; this inline list
// must stay in lockstep with it (mirrors the ROAD_RUN_STATES inlining pattern).
// A new enum member added in @fleet/domain should be added here too.
import { describe, it, expect } from 'vitest';
import { OrderTimelineSchema, OrderTimelineEventSchema } from '../src/order-timeline-contract.js';

const U = '11111111-aaaa-4aaa-8aaa-111111111111';
const T = '2026-06-11T13:34:58.000Z';

// Lockstep mirror of @fleet/domain CANCEL_REASONS (inlined: sync-protocol takes
// no @fleet/* runtime dep). Keep in sync with packages/domain/src/transport/cancel-reason.ts.
const CANCEL_REASONS = [
  'customer_request',
  'driver_unavailable',
  'vehicle_breakdown',
  'weather',
  'duplicate',
  'other',
] as const;

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
      { eventType: 'order_cancelled', at: T, reason: 'customer_request', note: null }).eventType).toBe('order_cancelled');
    expect(OrderTimelineEventSchema.parse(
      { eventType: 'manifest_rejected', at: T, manifestId: U, boundStopSequence: null, reasonText: null }).eventType).toBe('manifest_rejected');
  });
  it('accepts order_cancelled with a null reason (audit row without a recorded reason)', () => {
    const e = OrderTimelineEventSchema.parse({ eventType: 'order_cancelled', at: T, reason: null, note: null });
    expect(e.eventType).toBe('order_cancelled');
  });
  it('accepts EVERY canonical cancel reason (lockstep with @fleet/domain CANCEL_REASONS)', () => {
    for (const reason of CANCEL_REASONS) {
      const e = OrderTimelineEventSchema.parse({ eventType: 'order_cancelled', at: T, reason, note: null });
      expect(e.eventType === 'order_cancelled' && e.reason).toBe(reason);
    }
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
