// apps/api/test/reference-crud.service.reactivate-unit.test.ts
// T5c coverage: when create*() catches a 23505 unique_violation AND the
// reactivate UPDATE returns a row, the service MUST return that row.
// Pure unit-level — mocks db so no Postgres needed.
import { describe, it, expect } from 'vitest';
import { ReferenceService } from '../src/reference/reference.service.js';
import { createOperatorContext } from '@fleet/test-fixtures';
function mkServiceWithReactivate(reactivatedRow: { id: string; label: string }): ReferenceService {
  const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
  const insertChain = {
    values: () => ({
      returning: () => Promise.reject(uniqueViolation),
    }),
  };
  const updateChain = {
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve([reactivatedRow]),
      }),
    }),
  };
  const tx = {
    insert: () => insertChain,
    update: () => updateChain,
  };
  const db = {
    insert: () => insertChain,
    update: () => updateChain,
    transaction: <T>(cb: (t: typeof tx) => Promise<T>): Promise<T> => cb(tx),
  };
  return new ReferenceService(db as never);
}
describe('ReferenceService reactivate-on-conflict (unit)', () => {
  const op = createOperatorContext();
  it('createCustomer returns the reactivated row when UPDATE flips active=true', async () => {
    const row = { id: 'c1', label: 'ReAct' };
    await expect(mkServiceWithReactivate(row).createCustomer(op, 'ReAct')).resolves.toEqual(row);
  });
  it('createCargoType returns the reactivated row when UPDATE flips active=true', async () => {
    const row = { id: 'g1', label: 'TẤM' };
    await expect(mkServiceWithReactivate(row).createCargoType(op, 'TẤM')).resolves.toEqual(row);
  });
  it('createVehicle returns the reactivated row when UPDATE flips active=true', async () => {
    const row = { id: 'v1', label: '99H-RA1' };
    await expect(mkServiceWithReactivate(row).createVehicle(op, '99H-RA1')).resolves.toEqual(row);
  });
  it('createWarehouse pickup returns the reactivated row when UPDATE flips active=true', async () => {
    const row = { id: 'w1', label: 'ReHouse' };
    await expect(mkServiceWithReactivate(row).createWarehouse(op, 'ReHouse', 'pickup')).resolves.toEqual(row);
  });
});
