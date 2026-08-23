// packages/sync-protocol/test/outbox-routing.test.ts
// (header + describe labels corrected: file moved from workers/main-worker)
import { describe, it, expect } from 'vitest';
import {
  routeOutboxRow,
  OUTBOX_ROUTING_POLICY_VERSION,
  OUTBOX_QUEUES,
} from '../src/outbox-routing.js';

describe('@fleet/sync-protocol - routeOutboxRow', () => {
  it('routes manifest_intake.requested to intake queue', () => {
    const r = routeOutboxRow({
      aggregateType: 'manifest_intake',
      eventType: 'manifest_intake.requested',
    });
    expect(r.accepted).toBe(true);
    if (r.accepted) {
      expect(r.queueName).toBe('intake');
      expect(r.policyVersion).toBe(OUTBOX_ROUTING_POLICY_VERSION);
    }
  });

  it('routes manifest.committed to erp queue', () => {
    const r = routeOutboxRow({ aggregateType: 'manifest', eventType: 'manifest.committed' });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.queueName).toBe('erp');
  });

  it('routes road_run.* to projections queue', () => {
    const r = routeOutboxRow({ aggregateType: 'road_run', eventType: 'road_run.assigned' });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.queueName).toBe('projections');
  });

  it('routes transport_order.* to projections queue', () => {
    const r = routeOutboxRow({
      aggregateType: 'transport_order',
      eventType: 'transport_order.created',
    });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.queueName).toBe('projections');
  });

  it('routes manifest.<other> to projections queue (manifest is also a projection aggregate)', () => {
    const r = routeOutboxRow({ aggregateType: 'manifest', eventType: 'manifest.uploaded' });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.queueName).toBe('projections');
  });

  it('routes stop.* to projections queue', () => {
    const r = routeOutboxRow({ aggregateType: 'stop', eventType: 'stop.arrived' });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.queueName).toBe('projections');
  });

  it('eventType "manifest.committed" with non-manifest aggregate routes to projections, not erp (kills line 58 left-side mutant)', () => {
    // The condition is `aggregateType === 'manifest' && eventType === 'manifest.committed'`.
    // Mutating the left side to `true` would route any 'manifest.committed' event
    // to 'erp' regardless of aggregateType. With a road_run aggregate, the
    // original routes to 'projections' (PROJECTION_AGGREGATES).
    const r = routeOutboxRow({ aggregateType: 'road_run', eventType: 'manifest.committed' });
    expect(r.accepted).toBe(true);
    if (r.accepted) expect(r.queueName).toBe('projections');
  });

  it('rejects unknown aggregate types with policy version', () => {
    const r = routeOutboxRow({ aggregateType: 'rocket', eventType: 'rocket.launched' });
    expect(r.accepted).toBe(false);
    expect(r.policyVersion).toBe(OUTBOX_ROUTING_POLICY_VERSION);
    if (!r.accepted) expect(r.rejectionCode).toBe('unknown_aggregate');
  });

  it('rejects manifest_intake.<other> as unknown_event_type with policy version', () => {
    const r = routeOutboxRow({
      aggregateType: 'manifest_intake',
      eventType: 'manifest_intake.cancelled',
    });
    expect(r.accepted).toBe(false);
    expect(r.policyVersion).toBe(OUTBOX_ROUTING_POLICY_VERSION);
    if (!r.accepted) expect(r.rejectionCode).toBe('unknown_event_type');
  });

  it('is deterministic', () => {
    const i = { aggregateType: 'road_run', eventType: 'road_run.x' };
    expect(routeOutboxRow(i)).toEqual(routeOutboxRow(i));
  });
});

import fc from 'fast-check';

describe('@fleet/sync-protocol - routeOutboxRow property invariants', () => {
  it('never throws; always returns a versioned decision', () => {
    fc.assert(
      fc.property(
        fc.record({
          aggregateType: fc.string({ minLength: 1, maxLength: 32 }),
          eventType: fc.string({ minLength: 1, maxLength: 64 }),
          payload: fc.anything(),
        }),
        (input) => {
          const r = routeOutboxRow(input);
          expect(r.policyVersion).toBe(OUTBOX_ROUTING_POLICY_VERSION);
          expect(typeof r.accepted).toBe('boolean');
          return true;
        },
      ),
    );
  });

  it('every accepted decision targets a known queue', () => {
    // Derived from the SSOT: hand-listing here already drifted once (missing 'extraction').
    const known = new Set<string>(Object.values(OUTBOX_QUEUES));
    fc.assert(
      fc.property(
        fc.constantFrom('manifest_intake', 'manifest', 'road_run', 'transport_order', 'stop'),
        fc.string({ minLength: 1, maxLength: 32 }),
        (aggregateType, suffix) => {
          const r = routeOutboxRow({
            aggregateType,
            eventType:
              aggregateType === 'manifest_intake'
                ? 'manifest_intake.requested'
                : aggregateType === 'manifest' && suffix === 'committed'
                  ? 'manifest.committed'
                  : `${aggregateType}.${suffix}`,
          });
          if (r.accepted) {
            expect(known.has(r.queueName)).toBe(true);
          }
          return true;
        },
      ),
    );
  });

  it('unknown aggregate types always reject with unknown_aggregate', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 32 })
          .filter(
            (s) =>
              ![
                'manifest_intake',
                'manifest_extraction',
                'manifest',
                'road_run',
                'transport_order',
                'stop',
                'driver_alert',
              ].includes(s),
          ),
        (aggregateType) => {
          const r = routeOutboxRow({ aggregateType, eventType: `${aggregateType}.x` });
          expect(r.accepted).toBe(false);
          if (!r.accepted) expect(r.rejectionCode).toBe('unknown_aggregate');
          return true;
        },
      ),
    );
  });
});

describe('@fleet/sync-protocol - driver_alert routing (T12 order alerts)', () => {
  it('exposes the alerts queue in OUTBOX_QUEUES', () => {
    expect(OUTBOX_QUEUES.ALERTS).toBe('alerts');
  });
  it('routes driver_alert.requested to the alerts queue with policy version', () => {
    const r = routeOutboxRow({
      aggregateType: 'driver_alert',
      eventType: 'driver_alert.requested',
    });
    expect(r.accepted).toBe(true);
    if (r.accepted) {
      expect(r.queueName).toBe('alerts');
      expect(r.policyVersion).toBe(OUTBOX_ROUTING_POLICY_VERSION);
    }
  });
  it('rejects driver_alert.<other> as unknown_event_type (alert events are explicit, never wildcard)', () => {
    const r = routeOutboxRow({
      aggregateType: 'driver_alert',
      eventType: 'driver_alert.cancelled',
    });
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.rejectionCode).toBe('unknown_event_type');
  });
});
