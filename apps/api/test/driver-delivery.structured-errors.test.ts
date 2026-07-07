// apps/api/test/driver-delivery.structured-errors.test.ts
// RED-first (forgiving-FSM arc, U4): DriverDeliveryService rejections become
// STRUCTURED 409s consumable by the presenters + the forgiving driver flow.
// Live P7 replay (2026-07-05) proved the defect: planned -> completed shipped
// as 400/VALIDATION_FAILED with an internal English diagnostic. Contract now:
//   TRANSITION rejection -> ConflictException (409), response object carries
//     message (Vietnamese, no internal state names / machine tokens),
//     code: INVALID_STATE_TRANSITION,
//     extensions: { currentState, allowedActions } DERIVED from roadRunFsm
//     (planned -> ['dispatched','cancelled'] per the domain table; terminal
//     states -> []).
//   MANIFEST GATE rejection -> ConflictException (409), keeps its actionable
//     per-instance Vietnamese counts, DROPS the debug bracket, carries
//     code: MANIFESTS_INCOMPLETE, extensions: { committed, required }.
// Uses the house mock-db harness style of driver-delivery.service.test.ts.
import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { DriverDeliveryService } from '../src/dispatch/driver-delivery.service.js';

interface Row { roadRunId: string; state: string; companyId: string; assignedOperatorId: string }
const OP = {
  operatorId: 'op-1', companyId: 'co-1', businessUnitId: 'co-1',
  depotId: 'co-1', legalEntityId: 'co-1',
} as never;

function dbReturningRow(row: Row | undefined): unknown {
  const tx = {
    select: vi.fn(() => tx), from: vi.fn(() => tx), where: vi.fn(() => tx),
    limit: vi.fn(() => Promise.resolve(row === undefined ? [] : [row])),
    update: vi.fn(() => tx), set: vi.fn(() => tx),
  };
  return { transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
}

async function caught(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    return e as HttpException;
  }
  throw new Error('expected rejection');
}

describe('DriverDeliveryService structured rejections', () => {
  it('transition rejection is 409 INVALID_STATE_TRANSITION with FSM-derived extensions', async () => {
    const svc = new DriverDeliveryService(dbReturningRow(
      { roadRunId: 'rr-1', state: 'planned', companyId: 'co-1', assignedOperatorId: 'op-1' },
    ) as never);
    const ex = await caught(svc.complete('rr-1', OP));
    expect(ex.getStatus()).toBe(409);
    const r = ex.getResponse() as Record<string, unknown>;
    expect(r['code']).toBe('INVALID_STATE_TRANSITION');
    expect(r['extensions']).toEqual({
      currentState: 'planned',
      allowedActions: ['dispatched', 'cancelled'],
    });
    const msg = String(r['message']);
    expect(msg).toContain('Không thể');
    expect(msg.includes('planned')).toBe(false);
    expect(msg.includes('INVALID_TRANSITION')).toBe(false);
    expect(msg.includes('->')).toBe(false);
  });

  it('terminal-state rejection ships an empty allowedActions array', async () => {
    const svc = new DriverDeliveryService(dbReturningRow(
      { roadRunId: 'rr-1', state: 'completed', companyId: 'co-1', assignedOperatorId: 'op-1' },
    ) as never);
    const ex = await caught(svc.start('rr-1', OP));
    expect(ex.getStatus()).toBe(409);
    const r = ex.getResponse() as Record<string, unknown>;
    expect(r['code']).toBe('INVALID_STATE_TRANSITION');
    expect(r['extensions']).toEqual({ currentState: 'completed', allowedActions: [] });
  });

  it('not-found ownership rejection stays a 404 (unchanged semantics)', async () => {
    const svc = new DriverDeliveryService(dbReturningRow(undefined) as never);
    const ex = await caught(svc.accept('rr-x', OP));
    expect(ex.getStatus()).toBe(404);
  });
});
