// apps/ops-web/src/features/dispatch/load-board.ts
// Server-only RSC loader per PDF "RSC reads from dispatch_board_projection".
// Pilot scope: in-memory mock until projection worker lands (week 7+).
import type { DispatchBoardRoadRun } from './types.js';

const PILOT_DATA: readonly DispatchBoardRoadRun[] = Object.freeze([
  Object.freeze({
    roadRunId: '11111111-1111-4111-8111-111111111111',
    state: 'planned' as const,
    assignedOperatorId: null,
    assignedAssetId: null,
    plannedStartAt: '2026-04-28T08:00:00.000Z',
    stopCount: 3,
    transportOrderRefs: Object.freeze(['TO-1001', 'TO-1002']),
  }),
  Object.freeze({
    roadRunId: '22222222-2222-4222-8222-222222222222',
    state: 'dispatched' as const,
    assignedOperatorId: 'op-driver-1',
    assignedAssetId: 'truck-7',
    plannedStartAt: '2026-04-28T09:00:00.000Z',
    stopCount: 2,
    transportOrderRefs: Object.freeze(['TO-1003']),
  }),
]);

export async function loadDispatchBoard(): Promise<readonly DispatchBoardRoadRun[]> {
  // Real implementation will query Postgres dispatch_board_projection.
  return Promise.resolve(PILOT_DATA);
}
