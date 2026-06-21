// apps/ops-web/src/features/dispatch/load-board.ts
// Server-only RSC loader. Reads JWT from fleet_session httpOnly cookie set by
// login server action (industry pattern: never expose token to client JS).
// PILOT_DATA fallback exists ONLY when NODE_ENV !== 'production'. In production
// we surface the failure (Next.js error.tsx boundary) rather than silently
// rendering stale fake data.
//
// The response is parsed against the SINGLE SOURCE OF TRUTH canonical contract
// DispatchBoardResponseSchema from @fleet/sync-protocol (the tolerant client
// view: unknown keys — e.g. the API's per-stop stopId — are dropped, and
// EXPAND-only nullable/default fields are applied). There is NO loader-local
// board schema; the API and ops-web parse/produce the same contract.
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DispatchBoardResponseSchema } from '@fleet/sync-protocol';
import type { DispatchBoardRoadRun } from './types.js';
const PILOT_DATA = Object.freeze([
  Object.freeze({
    roadRunId: '11111111-1111-4111-8111-111111111111',
    state: 'planned' as const,
    assignedOperatorId: null,
    assignedAssetId: null,
    driverName: null,
    vehiclePlate: null,
    plannedStartAt: '2026-04-28T08:00:00.000Z',
    stopCount: 3,
    transportOrderRefs: Object.freeze(['TO-1001', 'TO-1002']),
    customerName: null,
    customerPhone: null,
    stops: Object.freeze([]),
  }),
  Object.freeze({
    roadRunId: '22222222-2222-4222-8222-222222222222',
    state: 'dispatched' as const,
    assignedOperatorId: '33333333-3333-4333-8333-333333333333',
    assignedAssetId: '44444444-4444-4444-8444-444444444444',
    driverName: 'NGUYỄN VĂN MẪU',
    vehiclePlate: '51A-12345',
    plannedStartAt: '2026-04-28T09:00:00.000Z',
    stopCount: 2,
    transportOrderRefs: Object.freeze(['TO-1003']),
    customerName: 'Công ty Mẫu',
    customerPhone: '0901234567',
    stops: Object.freeze([]),
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
    // No session: redirect to /login. In production this is the expected
    // path for unauthenticated visits; throwing would kill the SSR render
    // and surface a generic 'Something went wrong' page that the user can't
    // recover from.
    if (isProduction()) {
      redirect('/login');
    }
    return PILOT_DATA;
  }
  const res = await fetch(apiUrl + '/dispatch/board', {
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + authToken },
  });
  if (!res.ok) {
    // 401 from the API means the cookie's JWT is expired or invalid.
    // Treat the same as missing session: redirect to /login so the user
    // can re-authenticate, instead of crashing the SSR render.
    if (res.status === 401) {
      if (isProduction()) {
        redirect('/login');
      }
      return PILOT_DATA;
    }
    if (isProduction()) {
      throw new Error('Dispatch board fetch failed: ' + String(res.status) + ' ' + res.statusText);
    }
    return PILOT_DATA;
  }
  const json = (await res.json()) as unknown;
  const parsed = DispatchBoardResponseSchema.safeParse(json);
  if (!parsed.success) {
    if (isProduction()) {
      throw new Error('Dispatch board response shape invalid: ' + parsed.error.message);
    }
    return PILOT_DATA;
  }
  return parsed.data.rows;
}
