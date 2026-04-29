// apps/api/test/dispatch.controller.test.ts
import { describe, it, expect } from 'vitest';
import { DispatchController } from '../src/dispatch/dispatch.controller.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

interface FakeRow {
  roadRunId: string;
  state: string;
  assignedOperatorId: string | null;
  assignedAssetId: string | null;
  plannedStartAt: Date | null;
  stopCount: number;
  transportOrderRefs: readonly string[];
}

function fakeDb(rows: FakeRow[]): { select: () => unknown } {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(rows),
          }),
        }),
      }),
    }),
  };
}

const OP: OperatorContext = {
  operatorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  companyId: '11111111-1111-4111-8111-111111111111',
  businessUnitId: '11111111-1111-4111-8111-111111111111',
  depotId: '11111111-1111-4111-8111-111111111111',
  legalEntityId: '11111111-1111-4111-8111-111111111111',
};

describe('DispatchController - GET /dispatch/board', () => {
  it('returns mapped rows scoped to operator companyId', async () => {
    const rows: FakeRow[] = [{
      roadRunId: 'aaaaaaaa-1111-4111-8111-111111111111',
      state: 'planned',
      assignedOperatorId: null,
      assignedAssetId: null,
      plannedStartAt: new Date('2026-04-29T12:00:00.000Z'),
      stopCount: 2,
      transportOrderRefs: ['TO-1', 'TO-2'],
    }];
    const ctrl = new DispatchController(fakeDb(rows) as never);
    const result = await ctrl.getBoard(OP);
    expect(result.rows).toHaveLength(1);
    const r = result.rows[0]; if (!r) throw new Error('expected row');
    expect(r.plannedStartAt).toBe('2026-04-29T12:00:00.000Z');
    expect(r.transportOrderRefs).toEqual(['TO-1', 'TO-2']);
  });

  it('handles null plannedStartAt', async () => {
    const rows: FakeRow[] = [{
      roadRunId: 'bbbbbbbb-1111-4111-8111-111111111111',
      state: 'planned',
      assignedOperatorId: null,
      assignedAssetId: null,
      plannedStartAt: null,
      stopCount: 0,
      transportOrderRefs: [],
    }];
    const ctrl = new DispatchController(fakeDb(rows) as never);
    const result = await ctrl.getBoard(OP);
    const r = result.rows[0]; if (!r) throw new Error('expected row');
    expect(r.plannedStartAt).toBeNull();
  });

  it('returns empty rows array when projection has no data for operator scope', async () => {
    const ctrl = new DispatchController(fakeDb([]) as never);
    const result = await ctrl.getBoard(OP);
    expect(result.rows).toEqual([]);
  });
});
