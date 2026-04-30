// apps/api/test/sync.service.test.ts
import { describe, it, expect } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { SyncService } from '../src/sync/sync.service.js';
import type { FleetDb } from '../src/database/database.module.js';

describe('@fleet/api - SyncService unit', () => {
  it('constructor accepts db dependency', () => {
    const db = mockDeep<FleetDb>();
    const service = new SyncService(db);
    expect(service).toBeInstanceOf(SyncService);
  });

  it('processSync returns ok with empty actions and zero cursor', async () => {
    const db = mockDeep<FleetDb>();
    db.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([{ maxSeq: '0' }]),
      }),
    }) as never);
    const service = new SyncService(db);
    const result = await service.processSync(
      { cursor: '0', actions: [] },
      {
        operatorId: 'op',
        companyId: 'co',
        businessUnitId: 'bu',
        depotId: 'd',
        legalEntityId: 'le',
      },
    );
    expect(result.status).toBe('ok');
    expect(result.results).toEqual([]);
  });

  it('deltasAfter returns empty when no rows', async () => {
    const db = mockDeep<FleetDb>();
    db.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    }) as never);
    const service = new SyncService(db);
    const deltas = await service.deltasAfter('5', {
      operatorId: 'op',
      companyId: 'co',
      businessUnitId: 'bu',
      depotId: 'd',
      legalEntityId: 'le',
    });
    expect(deltas).toEqual([]);
  });



  it('detects PG unique violation in nested cause chain (line 28)', async () => {
    const op = { operatorId: 'op', companyId: 'co', businessUnitId: 'bu', depotId: 'd', legalEntityId: 'le' };
    const action = { actionId: '00000000-0000-0000-0000-0000000000a3', aggregateType: 'transport_order', aggregateId: '00000000-0000-0000-0000-000000000010', payload: {}, timestamp: '2026-04-30T00:00:00.000Z' };
    const inner = Object.assign(new Error('inner'), { code: '23505' });
    const wrapped = new Error('outer');
    (wrapped as Error & { cause: unknown }).cause = inner;
    const db = mockDeep<FleetDb>();
    db.transaction.mockRejectedValue(wrapped);
    db.select.mockImplementation(() => ({ from: () => ({ where: () => Promise.resolve([{ maxSeq: '0' }]) }) }) as never);
    const svc = new SyncService(db);
    const result = await svc.processSync({ cursor: '0', actions: [action] }, op);
    expect(result.results).toEqual(['duplicate']);
  });

  it('returns rejected when transaction rejects with non-Error value (line 130-131)', async () => {
    const op = { operatorId: 'op', companyId: 'co', businessUnitId: 'bu', depotId: 'd', legalEntityId: 'le' };
    const action = { actionId: '00000000-0000-0000-0000-0000000000a4', aggregateType: 'transport_order', aggregateId: '00000000-0000-0000-0000-000000000011', payload: {}, timestamp: '2026-04-30T00:00:00.000Z' };
    const db = mockDeep<FleetDb>();
    db.transaction.mockRejectedValue('plain string err');
    db.select.mockImplementation(() => ({ from: () => ({ where: () => Promise.resolve([{ maxSeq: '0' }]) }) }) as never);
    const svc = new SyncService(db);
    const result = await svc.processSync({ cursor: '0', actions: [action] }, op);
    expect(result.results).toEqual(['rejected']);
  });
});
