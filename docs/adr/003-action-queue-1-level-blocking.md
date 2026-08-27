<!--
File:    FleetManagement/docs/adr/003-action-queue-1-level-blocking.md
Purpose: Pin the design constraint that local_action_log.blocked_by_action_id
         is intentionally 1-level deep (not a transitive DAG).
Related: apps/driver-app/src/storage/schema.ts
         apps/driver-app/src/storage/action-queue-policy.ts
         Frozen Stack PDF page 2: "local_action_log (FIFO per-aggregate;
         blocked_by_action_id for upload->sync only)"
-->

# ADR-003: Action Queue Blocking Is 1-Level Only

- **Status**: Accepted
- **Date**: 2026-04-27
- **Related**: Frozen Stack PDF "Local store" section

## Context

`local_action_log.blocked_by_action_id` exists to chain a sync action behind its associated upload
action. The PDF specifies this as "blocked_by_action_id for upload->sync only".

A future contributor might assume the field supports arbitrary dependency chains (A blocks B blocks
C). It does not.

## Decision

Blocking is **1 level deep by design**:

- Upload actions are never blocked (`blocked_by_action_id IS NULL`).
- Sync actions may reference the upload's `action_id` as their blocker.
- No action references a sync action as its blocker. No chains form.

`dispatchableActions()` therefore checks only direct blocker status. If a malformed input creates a
chain (A->B->C), B becomes dispatchable only after A syncs (cycle 2), and C only after B syncs
(cycle 3). Resolution is sync-cycle-iterative, never single-pass.

## Consequences

- **Simpler reasoning**: O(N) dispatch decision, no graph traversal.
- **No topological sort needed**: Chains are not a supported input shape.
- **Test contract**: `action-queue-policy.test.ts` includes a test pinning this 3-cycle resolution
  behavior so future "improvements" to add transitive resolution fail loudly.

If the data model ever needs deeper chains (e.g. signature -> upload -> sync -> handoff), a new ADR
must supersede this one and the dispatcher must be upgraded to topological sort.
