// workers/main-worker/src/projections/projection-policy.ts
// Pure event -> projection delta functions per Frozen Stack PDF
// "projection_status table keyed by (projection_name, scope) with watermark,
// lag_ms, last_rebuilt_at" and Day-One #7 "RSC reads from
// dispatch_board_projection".
//
// Pilot scope: dispatch_board_projection only. Other projections (operator,
// depot, etc.) deferred per PDF "projection_status keyed by (projection_name, scope)".
//
// Worker stays DB-free: API and projection job runner own DB writes.
// This module computes the next projection state deterministically given the
// previous state + a sync_change_feed event.


import { z } from 'zod';

/** Zod schema for sync_change_feed events at the projection boundary.
 *  serverSeq is bigint at runtime; coerced from string|number|bigint at parse. */
export const SyncFeedEventSchema = z.object({
  serverSeq: z.union([z.bigint(), z.number(), z.string()]).transform((v) => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') {
      if (!Number.isInteger(v) || v < 0) throw new Error('serverSeq must be non-negative integer');
      return BigInt(v);
    }
    return BigInt(v);
  }),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.string().uuid(),
  delta: z.unknown(),
}).strict();

export const PROJECTION_POLICY_VERSION = 'projection-dispatch-board-v1' as const;

export const DISPATCH_BOARD_PROJECTION_NAME = 'dispatch_board' as const;

import { ROAD_RUN_STATES, type RoadRunState } from '@fleet/domain';

/** Re-exported alias to keep prior public name; canonical type lives in @fleet/domain. */
export type RoadRunStateValue = RoadRunState;

/** Aggregate types this projection observes. Other types are no-ops. */
export type ObservedAggregateType = 'road_run';

export interface RoadRunProjectionRow {
  readonly roadRunId: string;
  readonly state: RoadRunStateValue;
  readonly assignedOperatorId: string | null;
  readonly assignedAssetId: string | null;
  readonly plannedStartAt: string | null;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
  /** Monotonic server_seq of the latest event applied to this row. */
  readonly serverSeq: bigint;
}

export interface SyncFeedEvent {
  readonly serverSeq: bigint;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly delta: unknown;
}

export type ProjectionDelta =
  | { readonly kind: 'noop'; readonly reason: 'unobserved_aggregate' | 'stale_event' | 'invalid_delta' }
  | { readonly kind: 'upsert'; readonly row: RoadRunProjectionRow }
  | { readonly kind: 'delete'; readonly roadRunId: string; readonly serverSeq: bigint };

interface RoadRunDeltaShape {
  readonly state?: unknown;
  readonly assignedOperatorId?: unknown;
  readonly assignedAssetId?: unknown;
  readonly plannedStartAt?: unknown;
  readonly stopCount?: unknown;
  readonly transportOrderRefs?: unknown;
  readonly tombstone?: unknown;
}

const VALID_STATES: ReadonlySet<RoadRunStateValue> = new Set(ROAD_RUN_STATES);

function pick<T>(fromDelta: T | undefined, fromCurrent: T): T {
  // Cannot use ?? here: T may include null which ?? would conflate with undefined.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return fromDelta === undefined ? fromCurrent : fromDelta;
}

function isObject(v: unknown): v is RoadRunDeltaShape {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNullableString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') return v;
  return undefined;
}

function asState(v: unknown): RoadRunStateValue | undefined {
  if (typeof v === 'string' && VALID_STATES.has(v as RoadRunStateValue)) {
    return v as RoadRunStateValue;
  }
  return undefined;
}

function asNonNegativeInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  return undefined;
}

function asStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  for (const item of v) {
    if (typeof item !== 'string') return undefined;
  }
  return v as readonly string[];
}

/**
 * Apply a sync_change_feed event to the dispatch_board projection row.
 * Pure: same inputs always yield same delta.
 *
 * @param event   The event to apply.
 * @param current The current projection row (or null if none exists).
 * @returns       A delta describing what should change.
 */
export function applyDispatchBoardEvent(
  event: SyncFeedEvent,
  current: RoadRunProjectionRow | null,
): ProjectionDelta {
  if (event.aggregateType !== 'road_run') {
    return { kind: 'noop', reason: 'unobserved_aggregate' };
  }
  if (current !== null && event.serverSeq <= current.serverSeq) {
    // PDF: "Monotonic gap-tolerant server_seq bigint". Old or duplicate event.
    return { kind: 'noop', reason: 'stale_event' };
  }
  if (current !== null && current.roadRunId !== event.aggregateId) {
    // Adapter contract violation: current row must match aggregateId. Reject
    // rather than corrupt the projection by merging fields from the wrong row.
    return { kind: 'noop', reason: 'invalid_delta' };
  }
  if (!isObject(event.delta)) {
    return { kind: 'noop', reason: 'invalid_delta' };
  }

  if (event.delta.tombstone === true) {
    return { kind: 'delete', roadRunId: event.aggregateId, serverSeq: event.serverSeq };
  }

  const state = asState(event.delta.state);
  if (state === undefined) {
    return { kind: 'noop', reason: 'invalid_delta' };
  }

  // Distinguish "field absent" (undefined) from "field present but invalid" (parser
  // returned undefined for a value that WAS provided). Silent fallback on
  // invalid-but-present fields would silently swallow upstream corruption per
  // round-8 review. We treat the event as invalid_delta so it is rejected at
  // the queue boundary and routed to outbox-dead-letter via the queue router.
  const has = (k: keyof RoadRunDeltaShape): boolean =>
    Object.prototype.hasOwnProperty.call(event.delta, k);

  const assignedOperatorId = asNullableString(event.delta.assignedOperatorId);
  if (has('assignedOperatorId') && assignedOperatorId === undefined) {
    return { kind: 'noop', reason: 'invalid_delta' };
  }
  const assignedAssetId = asNullableString(event.delta.assignedAssetId);
  if (has('assignedAssetId') && assignedAssetId === undefined) {
    return { kind: 'noop', reason: 'invalid_delta' };
  }
  const plannedStartAt = asNullableString(event.delta.plannedStartAt);
  if (has('plannedStartAt') && plannedStartAt === undefined) {
    return { kind: 'noop', reason: 'invalid_delta' };
  }
  const stopCount = asNonNegativeInt(event.delta.stopCount);
  if (has('stopCount') && stopCount === undefined) {
    return { kind: 'noop', reason: 'invalid_delta' };
  }
  const transportOrderRefs = asStringArray(event.delta.transportOrderRefs);
  if (has('transportOrderRefs') && transportOrderRefs === undefined) {
    return { kind: 'noop', reason: 'invalid_delta' };
  }

  // For an initial row creation, all required fields must be present.
  if (current === null) {
    if (
      assignedOperatorId === undefined ||
      assignedAssetId === undefined ||
      plannedStartAt === undefined ||
      stopCount === undefined ||
      transportOrderRefs === undefined
    ) {
      return { kind: 'noop', reason: 'invalid_delta' };
    }
    return {
      kind: 'upsert',
      row: {
        roadRunId: event.aggregateId,
        state,
        assignedOperatorId,
        assignedAssetId,
        plannedStartAt,
        stopCount,
        transportOrderRefs,
        serverSeq: event.serverSeq,
      },
    };
  }

  // Update path: state is required on every event (asState above guarantees it).
  // Other fields are optional; absent fields preserve existing values, present-but-invalid
  // fields rejected the event above.
  return {
    kind: 'upsert',
    row: {
      roadRunId: event.aggregateId,
      state,
      // Pick: explicit `undefined` means "absent in delta" -> preserve current.
      // `null` and other valid values from the delta override current (so explicit
      // null clears nullable fields). `??` is wrong here because it conflates null
      // with undefined; we use a small helper to keep eslint happy.
      assignedOperatorId: pick(assignedOperatorId, current.assignedOperatorId),
      assignedAssetId: pick(assignedAssetId, current.assignedAssetId),
      plannedStartAt: pick(plannedStartAt, current.plannedStartAt),
      stopCount: pick(stopCount, current.stopCount),
      transportOrderRefs: pick(transportOrderRefs, current.transportOrderRefs),
      serverSeq: event.serverSeq,
    },
  };
}
