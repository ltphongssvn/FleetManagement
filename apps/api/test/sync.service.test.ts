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
});
