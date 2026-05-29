// workers/main-worker/src/outbox/outbox-routing.ts
// Re-export of canonical routing policy from @fleet/sync-protocol.
// Both apps/api (relay producer) and the worker share the same contract.
export {
  OUTBOX_ROUTING_POLICY_VERSION,
  routeOutboxRow,
  type OutboxRoutingInput,
  type OutboxRoutingDecision,
  type OutboxRoutingRejectionCode,
  type OutboxTargetQueue,
} from '@fleet/sync-protocol';
