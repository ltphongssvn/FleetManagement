// apps/api/test/device.service.unit.test.ts
// Unit tests for DeviceService — kill Stryker mutants by mocking drizzle chains
// and the pg-errors helper.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';

const { mockIsPgUniqueViolation } = vi.hoisted(() => ({
  mockIsPgUniqueViolation: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, value: unknown) => ({ _kind: 'eq', col, value }),
  and: (...preds: unknown[]) => ({ _kind: 'and', preds }),
  isNull: (col: unknown) => ({ _kind: 'isNull', col }),
}));

vi.mock('../src/database/schema/device.js', () => ({
  deviceRegistry: { deviceId: 'deviceRegistry.deviceId' },
  deviceSession: {
    deviceSessionId: 'deviceSession.deviceSessionId',
    revokedAt: 'deviceSession.revokedAt',
  },
}));

vi.mock('../src/common/pg-errors.js', () => ({
  isPgUniqueViolationOnConstraintInChain: mockIsPgUniqueViolation,
}));

import { DeviceService } from '../src/device/device.service.js';
import { SESSION_MODES } from '@fleet/domain';

interface InsertCall {
  values: Record<string, unknown>;
}
interface UpdateSetCall {
  values: Record<string, unknown>;
}
interface SelectCall {
  shape?: Record<string, unknown> | undefined;
}
interface WhereCall {
  predicate: unknown;
}
interface FakeDb {
  insertCalls: InsertCall[];
  updateSetCalls: UpdateSetCall[];
  selectCalls: SelectCall[];
  whereCalls: WhereCall[];
  db: object;
}

interface MakeDbOptions {
  insertReturns?: unknown[];
  insertThrows?: unknown;
  updateReturns?: unknown[];
  selectReturnsByCall?: unknown[][];
}

function makeFakeDb(opts: MakeDbOptions): FakeDb {
  const insertCalls: InsertCall[] = [];
  const updateSetCalls: UpdateSetCall[] = [];
  const selectCalls: SelectCall[] = [];
  const whereCalls: WhereCall[] = [];
  let selectIdx = 0;
  const db = {
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ values });
        return {
          returning: () => {
            if (opts.insertThrows !== undefined) return Promise.reject(opts.insertThrows as Error);
            return Promise.resolve(opts.insertReturns ?? []);
          },
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updateSetCalls.push({ values });
        return {
          where: (predicate: unknown) => {
            whereCalls.push({ predicate });
            return {
              returning: () => Promise.resolve(opts.updateReturns ?? []),
            };
          },
        };
      },
    }),
    select: (shape?: Record<string, unknown>) => {
      selectCalls.push({ shape });
      return {
        from: (_t: unknown) => ({
          where: (predicate: unknown) => {
            whereCalls.push({ predicate });
            const rows = opts.selectReturnsByCall?.[selectIdx] ?? [];
            selectIdx++;
            return {
              limit: (_n: number) => Promise.resolve(rows),
            };
          },
        }),
      };
    },
  };
  return { insertCalls, updateSetCalls, selectCalls, whereCalls, db: db as object };
}

const ISSUE_INPUT = Object.freeze({
  deviceId: 'd1',
  operatorId: 'op1',
  surface: 'road',
  sessionMode: 'mutating',
  companyId: 'c1',
  businessUnitId: 'bu1',
  depotId: 'dp1',
  legalEntityId: 'le1',
});

beforeEach(() => {
  mockIsPgUniqueViolation.mockReset();
  mockIsPgUniqueViolation.mockReturnValue(false);
  vi.useRealTimers();
});

describe('@fleet/api - DeviceService.issueSession (unit)', () => {
  it('inserts a session row and returns it', async () => {
    const row = { deviceSessionId: 's1', ...ISSUE_INPUT };
    const fake = makeFakeDb({ insertReturns: [row] });
    const svc = new DeviceService(fake.db as never);
    const result = await svc.issueSession(ISSUE_INPUT);
    expect(result).toBe(row);
    expect(fake.insertCalls).toHaveLength(1);
  });

  it('passes all 8 fields to .values() in the insert', async () => {
    const row = { deviceSessionId: 's1' };
    const fake = makeFakeDb({ insertReturns: [row] });
    const svc = new DeviceService(fake.db as never);
    await svc.issueSession(ISSUE_INPUT);
    const call = fake.insertCalls[0];
    if (!call) throw new Error('expected insert call');
    expect(call.values).toEqual({
      deviceId: 'd1',
      operatorId: 'op1',
      surface: 'road',
      sessionMode: 'mutating',
      companyId: 'c1',
      businessUnitId: 'bu1',
      depotId: 'dp1',
      legalEntityId: 'le1',
    });
  });

  it('throws SessionInsertFailedError when returning() yields no rows (kills !row mutants)', async () => {
    const fake = makeFakeDb({ insertReturns: [] });
    const svc = new DeviceService(fake.db as never);
    await expect(svc.issueSession(ISSUE_INPUT)).rejects.toThrow(/Session insert failed|insert/i);
  });

  it('translates Postgres unique-violation on the partial index into ConflictException', async () => {
    mockIsPgUniqueViolation.mockReturnValue(true);
    const pgErr = new Error('duplicate key');
    const fake = makeFakeDb({ insertThrows: pgErr });
    const svc = new DeviceService(fake.db as never);
    await expect(svc.issueSession(ISSUE_INPUT)).rejects.toThrow(ConflictException);
    expect(mockIsPgUniqueViolation).toHaveBeenCalledWith(
      pgErr,
      'device_session_one_mutating_per_operator_surface_uq',
    );
  });

  it('rethrows non-unique-violation errors verbatim', async () => {
    mockIsPgUniqueViolation.mockReturnValue(false);
    const pgErr = new Error('some other db error');
    const fake = makeFakeDb({ insertThrows: pgErr });
    const svc = new DeviceService(fake.db as never);
    await expect(svc.issueSession(ISSUE_INPUT)).rejects.toBe(pgErr);
  });
});

describe('@fleet/api - DeviceService.revokeSession (unit)', () => {
  it('updates with revokedAt + revocationReason and returns the row', async () => {
    const row = { deviceSessionId: 's1', revokedAt: new Date() };
    const fake = makeFakeDb({ updateReturns: [row] });
    const svc = new DeviceService(fake.db as never);
    const result = await svc.revokeSession('s1', 'operator_logout');
    expect(result).toBe(row);
    const setCall = fake.updateSetCalls[0];
    if (!setCall) throw new Error('expected set call');
    expect(setCall.values['revokedAt']).toBeInstanceOf(Date);
    expect(setCall.values['revocationReason']).toBe('operator_logout');
  });

  it('returns existing row when update returns nothing but session exists (idempotent re-revoke)', async () => {
    const existing = { deviceSessionId: 's1', revokedAt: new Date('2026-01-01') };
    const fake = makeFakeDb({ updateReturns: [], selectReturnsByCall: [[existing]] });
    const svc = new DeviceService(fake.db as never);
    const result = await svc.revokeSession('s1', 'operator_logout');
    expect(result).toBe(existing);
  });

  it('throws NotFoundException when update returns nothing and session does not exist', async () => {
    const fake = makeFakeDb({ updateReturns: [], selectReturnsByCall: [[]] });
    const svc = new DeviceService(fake.db as never);
    await expect(svc.revokeSession('s1', 'operator_logout')).rejects.toThrow(NotFoundException);
  });
});

describe('@fleet/api - DeviceService.findActiveSession (unit)', () => {
  it('returns the row when an active session exists', async () => {
    const row = { deviceSessionId: 's1', revokedAt: null };
    const fake = makeFakeDb({ selectReturnsByCall: [[row]] });
    const svc = new DeviceService(fake.db as never);
    const result = await svc.findActiveSession('s1');
    expect(result).toBe(row);
  });

  it('returns null when no active session matches (kills ?? null mutants)', async () => {
    const fake = makeFakeDb({ selectReturnsByCall: [[]] });
    const svc = new DeviceService(fake.db as never);
    const result = await svc.findActiveSession('s1');
    expect(result).toBeNull();
  });

  it('filters by (deviceSessionId AND revokedAt IS NULL)', async () => {
    const fake = makeFakeDb({ selectReturnsByCall: [[]] });
    const svc = new DeviceService(fake.db as never);
    await svc.findActiveSession('s1');
    const whereCall = fake.whereCalls[0];
    if (!whereCall) throw new Error('expected where call');
    expect(whereCall.predicate).toMatchObject({
      _kind: 'and',
      preds: [
        { _kind: 'eq', col: 'deviceSession.deviceSessionId', value: 's1' },
        { _kind: 'isNull', col: 'deviceSession.revokedAt' },
      ],
    });
  });
});

describe('@fleet/api - DeviceService.getSupportedModes (unit)', () => {
  it('returns the SESSION_MODES constant from @fleet/domain (kills wholesale-body mutant)', () => {
    const fake = makeFakeDb({});
    const svc = new DeviceService(fake.db as never);
    expect(svc.getSupportedModes()).toBe(SESSION_MODES);
  });
});

describe('@fleet/api - DeviceService.deviceExists (unit)', () => {
  it('returns true when a registry row matches', async () => {
    const fake = makeFakeDb({ selectReturnsByCall: [[{ id: 'd1' }]] });
    const svc = new DeviceService(fake.db as never);
    expect(await svc.deviceExists('d1')).toBe(true);
  });

  it('returns false when no registry row matches (kills row !== undefined boundary)', async () => {
    const fake = makeFakeDb({ selectReturnsByCall: [[]] });
    const svc = new DeviceService(fake.db as never);
    expect(await svc.deviceExists('missing')).toBe(false);
  });

  it('selects with an id column shape (kills .select({}) ObjectLiteral mutant)', async () => {
    const fake = makeFakeDb({ selectReturnsByCall: [[{ id: 'd1' }]] });
    const svc = new DeviceService(fake.db as never);
    await svc.deviceExists('d1');
    const sel = fake.selectCalls[0];
    if (!sel) throw new Error('expected select call');
    expect(sel.shape && Object.keys(sel.shape)).toContain('id');
  });
});
