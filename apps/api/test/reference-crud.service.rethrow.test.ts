// apps/api/test/reference-crud.service.rethrow.test.ts
// T5b/T5c coverage: ReferenceService.create*/update* MUST translate
// Postgres 23505 unique_violation to ConflictException, and rethrow
// any non-23505 error verbatim. The create* methods wrap their INSERT
// in a nested db.transaction(...) (SAVEPOINT) so a unique-violation
// aborts only that subtransaction; the mocked db exposes both
// .transaction(cb) and the direct .insert/.update chains so both code
// paths can be exercised without a real Postgres.
import { describe, it, expect } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ReferenceService } from '../src/reference/reference.service.js';
import { createOperatorContext } from '@fleet/test-fixtures';
function mkServiceWithError(err: Error): ReferenceService {
  // .where() must behave two ways:
  //   * for update* calls: it is awaited directly -> reject with err.
  //   * for create* reactivate path: caller chains .returning() -> [].
  // We achieve that with a thenable that ALSO exposes .returning().
  const makeWhere = (): unknown => {
    const obj: {
      returning: () => Promise<unknown[]>;
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => void;
    } = {
      returning: () => Promise.resolve([]),
      then: (_resolve, reject) => {
        reject(err);
      },
    };
    return obj;
  };
  const insertChain = {
    values: () => ({
      returning: () => Promise.reject(err),
    }),
  };
  const updateChain = {
    set: () => ({
      where: () => makeWhere(),
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
function pgUniqueViolation(): Error & { code: string } {
  const e = new Error('duplicate key value violates unique constraint') as Error & { code: string };
  e.code = '23505';
  return e;
}
function genericDbError(): Error & { code: string } {
  const e = new Error('connection terminated') as Error & { code: string };
  e.code = '08006';
  return e;
}
describe('ReferenceService unique-violation translation (unit)', () => {
  const op = createOperatorContext();
  it('createCustomer translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).createCustomer(op, 'X'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('createCustomer rethrows non-23505 verbatim', async () => {
    const err = genericDbError();
    await expect(mkServiceWithError(err).createCustomer(op, 'X')).rejects.toBe(err);
  });
  it('updateCustomer translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).updateCustomer(op, 'id', 'X'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('updateCustomer rethrows non-23505 verbatim', async () => {
    const err = genericDbError();
    await expect(mkServiceWithError(err).updateCustomer(op, 'id', 'X')).rejects.toBe(err);
  });
  it('createCargoType translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).createCargoType(op, 'X'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('createCargoType rethrows non-23505 verbatim', async () => {
    const err = genericDbError();
    await expect(mkServiceWithError(err).createCargoType(op, 'X')).rejects.toBe(err);
  });
  it('updateCargoType translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).updateCargoType(op, 'id', 'X'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('updateCargoType rethrows non-23505 verbatim', async () => {
    const err = genericDbError();
    await expect(mkServiceWithError(err).updateCargoType(op, 'id', 'X')).rejects.toBe(err);
  });
  it('createVehicle translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).createVehicle(op, 'X'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('createVehicle rethrows non-23505 verbatim', async () => {
    const err = genericDbError();
    await expect(mkServiceWithError(err).createVehicle(op, 'X')).rejects.toBe(err);
  });
  it('updateVehicle translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).updateVehicle(op, 'id', 'X'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('updateVehicle rethrows non-23505 verbatim', async () => {
    const err = genericDbError();
    await expect(mkServiceWithError(err).updateVehicle(op, 'id', 'X')).rejects.toBe(err);
  });
  it('createWarehouse pickup translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).createWarehouse(op, 'X', 'pickup'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('createWarehouse delivery translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).createWarehouse(op, 'X', 'delivery'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('createWarehouse rethrows non-23505 verbatim', async () => {
    const err = genericDbError();
    await expect(mkServiceWithError(err).createWarehouse(op, 'X', 'pickup')).rejects.toBe(err);
  });
  it('updateWarehouse translates 23505 to ConflictException', async () => {
    await expect(
      mkServiceWithError(pgUniqueViolation()).updateWarehouse(op, 'id', 'X'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('updateWarehouse rethrows non-23505 verbatim', async () => {
    const err = genericDbError();
    await expect(mkServiceWithError(err).updateWarehouse(op, 'id', 'X')).rejects.toBe(err);
  });
});
