// apps/ops-web/src/features/dispatch/load-board.ts
// Server-only RSC loader. Reads JWT from fleet_session httpOnly cookie set by
// login server action (industry pattern: never expose token to client JS).
// PILOT_DATA fallback exists ONLY when NODE_ENV !== 'production'. In production
// we surface the failure (Next.js error.tsx boundary) rather than silently
// rendering stale fake data.
import 'server-only';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ROAD_RUN_STATES, type RoadRunState } from '@fleet/domain';
import type { DispatchBoardRoadRun } from './types.js';
const BoardRowSchema = z.object({
  roadRunId: z.string().uuid(),
  state: z.enum(ROAD_RUN_STATES as unknown as [RoadRunState, ...RoadRunState[]]),
  assignedOperatorId: z.union([z.string().uuid(), z.null()]),
  assignedAssetId: z.union([z.string().uuid(), z.null()]),
  plannedStartAt: z.union([z.string(), z.null()]),
  stopCount: z.number().int().nonnegative(),
  transportOrderRefs: z.array(z.string()).readonly(),
});
const BoardResponseSchema = z.object({
  rows: z.array(BoardRowSchema).readonly(),
});
const PILOT_DATA = Object.freeze([
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
    assignedOperatorId: '33333333-3333-4333-8333-333333333333',
    assignedAssetId: '44444444-4444-4444-8444-444444444444',
    plannedStartAt: '2026-04-28T09:00:00.000Z',
    stopCount: 2,
    transportOrderRefs: Object.freeze(['TO-1003']),
  }),
]) satisfies readonly DispatchBoardRoadRun[];
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
export async function loadDispatchBoard(): Promise<readonly DispatchBoardRoadRun[]> {
  const apiUrl = process.env['FLEET_API_URL'];
  if (!apiUrl) {
    if (isProduction()) {
      throw new Error('FLEET_API_URL must be set in production');
    }
    return PILOT_DATA;
  }
  const cookieStore = await cookies();
  const authToken = cookieStore.get('fleet_session')?.value;
  if (!authToken) {
    if (isProduction()) {
      throw new Error('No active session: fleet_session cookie missing');
    }
    return PILOT_DATA;
  }
  const res = await fetch(`${apiUrl}/dispatch/board`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) {
    if (isProduction()) {
      throw new Error(`Dispatch board fetch failed: ${String(res.status)} ${res.statusText}`);
    }
    return PILOT_DATA;
  }
  const json = (await res.json()) as unknown;
  const parsed = BoardResponseSchema.safeParse(json);
  if (!parsed.success) {
    if (isProduction()) {
      throw new Error(`Dispatch board response shape invalid: ${parsed.error.message}`);
    }
    return PILOT_DATA;
  }
  return parsed.data.rows;
}
