// packages/test-fixtures/src/sync-fixtures.ts
// Factory functions for sync protocol test data.
// Produces valid, minimal defaults — callers override fields as needed.

import {
  type SyncRequest,
  type SyncResponse,
  type SyncAction,
  type SyncStatus,
  type SyncActionResult,
  createActionId,
  createSyncCursor,
  createAggregateId,
} from '@fleet/sync-protocol';

/** Create a minimal valid SyncAction with sensible defaults. */
export function createMockSyncAction(
  overrides: Partial<{
    actionId: string;
    aggregateType: string;
    aggregateId: string;
    payload: unknown;
    timestamp: string;
  }> = {},
): SyncAction {
  return {
    actionId: createActionId(overrides.actionId ?? '018f4d3c-0001-7000-8000-000000000001'),
    aggregateType: overrides.aggregateType ?? 'transport_order',
    aggregateId: createAggregateId(overrides.aggregateId ?? '018f4d3c-0002-7000-8000-000000000002'),
    payload: overrides.payload ?? {},
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  };
}

/** Create a minimal valid SyncRequest with sensible defaults. */
export function createMockSyncRequest(
  overrides: Partial<{
    cursor: string;
    actions: SyncAction[];
  }> = {},
): SyncRequest {
  return {
    cursor: createSyncCursor(overrides.cursor ?? 'cursor-000'),
    actions: overrides.actions ?? [createMockSyncAction()],
  };
}

/** Create a minimal valid SyncResponse with sensible defaults. */
export function createMockSyncResponse(
  overrides: Partial<{
    status: SyncStatus;
    newCursor: string;
    eventSeq: number;
    deltas: readonly unknown[];
    results: readonly SyncActionResult[];
    serverTime: string;
    projectionStatus: Record<string, unknown>;
    hysteresisVersion: number;
    configFlagVersion: number;
    retryAfterMs: number;
  }> = {},
): SyncResponse {
  return {
    status: overrides.status ?? 'ok',
    newCursor: createSyncCursor(overrides.newCursor ?? 'cursor-001'),
    eventSeq: overrides.eventSeq ?? 1,
    deltas: overrides.deltas ?? [],
    results: overrides.results ?? ['applied'],
    serverTime: overrides.serverTime ?? new Date().toISOString(),
    projectionStatus: overrides.projectionStatus ?? {},
    hysteresisVersion: overrides.hysteresisVersion ?? 1,
    configFlagVersion: overrides.configFlagVersion ?? 1,
    ...(overrides.retryAfterMs !== undefined && {
      retryAfterMs: overrides.retryAfterMs,
    }),
  };
}
