// packages/sync-protocol/src/outbox-routing.ts
// Pure outbox routing policy. Lives in @fleet/sync-protocol because both
// apps/api (relay producer) and workers/main-worker (consumer) need to agree
// on the same wire contract per Frozen Stack PDF "@sync-protocol — wire types".
//
// Day-One Pilot Plan #8: outbox -> {intake, erp, projections} dispatch.
// Pure function so the API relay and any worker-side audit can reuse it
// without DB or Redis dependencies.

export const OUTBOX_ROUTING_POLICY_VERSION = 'outbox-routing-v1' as const;

/** Queue names the outbox can dispatch to. Subset of QUEUE_NAMES from worker. */
export const OUTBOX_QUEUES = {
  INTAKE: 'intake',
  EXTRACTION: 'extraction',
  ERP: 'erp',
  PROJECTIONS: 'projections',
  ALERTS: 'alerts',
} as const;
export type OutboxQueueName = (typeof OUTBOX_QUEUES)[keyof typeof OUTBOX_QUEUES];
/** Alias kept for routing-policy callsites; new code should use OutboxQueueName. */
export type OutboxTargetQueue = OutboxQueueName;

export type OutboxRoutingRejectionCode = 'unknown_aggregate' | 'unknown_event_type';

export interface OutboxRoutingInput {
  readonly aggregateType: string;
  readonly eventType: string;
}

export type OutboxRoutingDecision =
  | {
      readonly accepted: true;
      readonly queueName: OutboxTargetQueue;
      readonly policyVersion: typeof OUTBOX_ROUTING_POLICY_VERSION;
    }
  | {
      readonly accepted: false;
      readonly rejectionCode: OutboxRoutingRejectionCode;
      readonly policyVersion: typeof OUTBOX_ROUTING_POLICY_VERSION;
    };

const PROJECTION_AGGREGATES: ReadonlySet<string> = new Set([
  'road_run',
  'transport_order',
  'manifest',
  'stop',
]);

/**
 * Decide the target queue for an outbox row.
 *
 * Pilot routing rules (Day-One Pilot Plan):
 *   manifest_intake.requested      -> 'intake'
 *   manifest.committed             -> 'erp' (invoice generation)
 *   driver_alert.requested         -> 'alerts' (T12 driver order alerts)
 *   <projection-aggregate>.*       -> 'projections'
 *   anything else                  -> unknown_aggregate / unknown_event_type
 */
export function routeOutboxRow(input: OutboxRoutingInput): OutboxRoutingDecision {
  if (input.aggregateType === 'manifest_intake') {
    if (input.eventType === 'manifest_intake.requested') {
      return { accepted: true, queueName: 'intake', policyVersion: OUTBOX_ROUTING_POLICY_VERSION };
    }
    return {
      accepted: false,
      rejectionCode: 'unknown_event_type',
      policyVersion: OUTBOX_ROUTING_POLICY_VERSION,
    };
  }
  if (input.aggregateType === 'manifest_extraction') {
    if (input.eventType === 'manifest_extraction.requested') {
      return {
        accepted: true,
        queueName: 'extraction',
        policyVersion: OUTBOX_ROUTING_POLICY_VERSION,
      };
    }
    return {
      accepted: false,
      rejectionCode: 'unknown_event_type',
      policyVersion: OUTBOX_ROUTING_POLICY_VERSION,
    };
  }
  if (input.aggregateType === 'manifest' && input.eventType === 'manifest.committed') {
    return { accepted: true, queueName: 'erp', policyVersion: OUTBOX_ROUTING_POLICY_VERSION };
  }
  if (input.aggregateType === 'driver_alert') {
    if (input.eventType === 'driver_alert.requested') {
      return { accepted: true, queueName: 'alerts', policyVersion: OUTBOX_ROUTING_POLICY_VERSION };
    }
    return {
      accepted: false,
      rejectionCode: 'unknown_event_type',
      policyVersion: OUTBOX_ROUTING_POLICY_VERSION,
    };
  }
  if (PROJECTION_AGGREGATES.has(input.aggregateType)) {
    return {
      accepted: true,
      queueName: 'projections',
      policyVersion: OUTBOX_ROUTING_POLICY_VERSION,
    };
  }
  return {
    accepted: false,
    rejectionCode: 'unknown_aggregate',
    policyVersion: OUTBOX_ROUTING_POLICY_VERSION,
  };
}
