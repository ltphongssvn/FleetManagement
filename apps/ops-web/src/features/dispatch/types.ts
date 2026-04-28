// apps/ops-web/src/features/dispatch/types.ts
// Mirrors API dispatch_board_projection per Frozen Stack PDF "Ops web (single page)".
import type { RoadRunState } from '@fleet/domain';

export interface DispatchBoardRoadRun {
  readonly roadRunId: string;
  readonly state: RoadRunState;
  readonly assignedOperatorId: string | null;
  readonly assignedAssetId: string | null;
  readonly plannedStartAt: string | null;
  readonly stopCount: number;
  readonly transportOrderRefs: readonly string[];
}
