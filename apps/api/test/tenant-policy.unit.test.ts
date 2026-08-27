// apps/api/test/tenant-policy.unit.test.ts
// Unit tests for TenantPolicy — kill Stryker mutants by mocking drizzle chain
// and schema marker columns.
import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ _kind: 'eq', col, value }),
  and: (...preds: unknown[]) => ({ _kind: 'and', preds }),
}));

vi.mock('../src/database/schema/device.js', () => ({
  deviceRegistry: {
    deviceId: 'deviceRegistry.deviceId',
    operatorId: 'deviceRegistry.operatorId',
    companyId: 'deviceRegistry.companyId',
  },
}));

vi.mock('../src/database/schema/transport.js', () => ({
  roadRun: {
    roadRunId: 'roadRun.roadRunId',
    companyId: 'roadRun.companyId',
  },
}));

import { TenantPolicy, CrossTenantError } from '../src/auth/tenant-policy.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

interface SelectCall {
  shape?: Record<string, unknown> | undefined;
}
interface WhereCall {
  predicate: unknown;
}
interface FakeDb {
  selectCalls: SelectCall[];
  whereCalls: WhereCall[];
  db: object;
}

function makeFakeDb(opts: { selectReturns?: unknown[] } = {}): FakeDb {
  const selectCalls: SelectCall[] = [];
  const whereCalls: WhereCall[] = [];
  const db = {
    select: (shape?: Record<string, unknown>) => {
      selectCalls.push({ shape });
      return {
        from: (_t: unknown) => ({
          where: (predicate: unknown) => {
            whereCalls.push({ predicate });
            return {
              limit: (_n: number) => Promise.resolve(opts.selectReturns ?? []),
            };
          },
        }),
      };
    },
  };
  return { selectCalls, whereCalls, db: db as object };
}

const OP: OperatorContext = Object.freeze({
  operatorId: 'op-1',
  companyId: 'co-1',
  businessUnitId: 'bu-1',
  depotId: 'dp-1',
  legalEntityId: 'le-1',
  expiresAt: 9_999_999_999,
}) as OperatorContext;

describe('@fleet/api - CrossTenantError', () => {
  it('has code="cross_tenant" (kills StringLiteral code mutant)', () => {
    const err = new CrossTenantError('operator', 'op-x');
    expect(err.code).toBe('cross_tenant');
  });

  it('message includes resource type and id (kills message template mutant)', () => {
    const err = new CrossTenantError('road_run', 'rr-42');
    expect(err.message).toContain('road_run');
    expect(err.message).toContain('rr-42');
  });
});

describe('@fleet/api - TenantPolicy.assertOperatorInTenant (unit)', () => {
  it('resolves when at least one device_registry row matches (kills length === 0 mutants)', async () => {
    const fake = makeFakeDb({ selectReturns: [{ id: 'd-1' }] });
    const svc = new TenantPolicy(fake.db as never);
    await expect(svc.assertOperatorInTenant('op-x', OP)).resolves.toBeUndefined();
  });

  it('throws CrossTenantError("operator", id) when no row matches', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new TenantPolicy(fake.db as never);
    await expect(svc.assertOperatorInTenant('op-x', OP)).rejects.toBeInstanceOf(CrossTenantError);
    try {
      await svc.assertOperatorInTenant('op-x', OP);
    } catch (err) {
      const e = err as CrossTenantError;
      expect(e.message).toContain('operator');
      expect(e.message).toContain('op-x');
    }
  });

  it('selects with deviceRegistry.deviceId column (kills .select({}) ObjectLiteral)', async () => {
    const fake = makeFakeDb({ selectReturns: [{ id: 'd-1' }] });
    const svc = new TenantPolicy(fake.db as never);
    await svc.assertOperatorInTenant('op-x', OP);
    const sel = fake.selectCalls[0];
    if (!sel) throw new Error('expected select call');
    expect(sel.shape).toEqual({ id: 'deviceRegistry.deviceId' });
  });

  it('filters by (operatorId AND companyId) — kills and()/eq() composition', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new TenantPolicy(fake.db as never);
    await expect(svc.assertOperatorInTenant('op-x', OP)).rejects.toThrow();
    const w = fake.whereCalls[0];
    if (!w) throw new Error('expected where call');
    expect(w.predicate).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'deviceRegistry.operatorId', value: 'op-x' },
        { _kind: 'eq', col: 'deviceRegistry.companyId', value: 'co-1' },
      ],
    });
  });
});

describe('@fleet/api - TenantPolicy.assertRoadRunInTenant (unit)', () => {
  it('resolves when road_run row matches', async () => {
    const fake = makeFakeDb({ selectReturns: [{ id: 'rr-1' }] });
    const svc = new TenantPolicy(fake.db as never);
    await expect(svc.assertRoadRunInTenant('rr-1', OP)).resolves.toBeUndefined();
  });

  it('throws CrossTenantError("road_run", id) when no row matches', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new TenantPolicy(fake.db as never);
    try {
      await svc.assertRoadRunInTenant('rr-x', OP);
      throw new Error('expected throw');
    } catch (err) {
      const e = err as CrossTenantError;
      expect(e).toBeInstanceOf(CrossTenantError);
      expect(e.message).toContain('road_run');
      expect(e.message).toContain('rr-x');
    }
  });

  it('selects with roadRun.roadRunId column (kills .select({}) ObjectLiteral)', async () => {
    const fake = makeFakeDb({ selectReturns: [{ id: 'rr-1' }] });
    const svc = new TenantPolicy(fake.db as never);
    await svc.assertRoadRunInTenant('rr-1', OP);
    const sel = fake.selectCalls[0];
    if (!sel) throw new Error('expected select call');
    expect(sel.shape).toEqual({ id: 'roadRun.roadRunId' });
  });

  it('filters by (roadRunId AND companyId) — kills and()/eq() composition', async () => {
    const fake = makeFakeDb({ selectReturns: [{ id: 'rr-1' }] });
    const svc = new TenantPolicy(fake.db as never);
    await svc.assertRoadRunInTenant('rr-1', OP);
    const w = fake.whereCalls[0];
    if (!w) throw new Error('expected where call');
    expect(w.predicate).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'roadRun.roadRunId', value: 'rr-1' },
        { _kind: 'eq', col: 'roadRun.companyId', value: 'co-1' },
      ],
    });
  });
});

describe('@fleet/api - TenantPolicy.assertAggregateInTenant (unit)', () => {
  it('delegates to assertRoadRunInTenant when aggregateType === "road_run"', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new TenantPolicy(fake.db as never);
    await expect(svc.assertAggregateInTenant('road_run', 'rr-x', OP)).rejects.toBeInstanceOf(
      CrossTenantError,
    );
    expect(fake.selectCalls).toHaveLength(1);
  });

  it('is a no-op for non-road_run aggregate types (kills equality mutants)', async () => {
    const fake = makeFakeDb({ selectReturns: [] });
    const svc = new TenantPolicy(fake.db as never);
    await expect(svc.assertAggregateInTenant('manifest', 'm-1', OP)).resolves.toBeUndefined();
    await expect(svc.assertAggregateInTenant('', 'x', OP)).resolves.toBeUndefined();
    expect(fake.selectCalls).toHaveLength(0);
  });
});
