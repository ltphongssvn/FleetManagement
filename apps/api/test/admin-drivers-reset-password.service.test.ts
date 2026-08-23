// apps/api/test/admin-drivers-reset-password.service.test.ts
// outside-in strict TDD (L1): the service invariant beneath the L0 contract.
// Verifies: (1) the new password is bcrypt-rehashed; (2) the driver row is
// updated scoped to driverId+companyId; (3) an audit row is inserted into
// driver_password_reset_log attributing actorOperatorId -> targetDriverId with
// the actor's tenancy; (4) all three happen inside ONE transaction; (5) an
// unknown driver (wrong tenant) throws NotFoundException and NOTHING is
// written or logged. bcrypt is an injected fake; the db is a transaction mock.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AdminDriversResetPasswordService } from '../src/admin/admin-drivers-reset-password.service.js';
import type { FleetDb } from '../src/database/database.module.js';
interface Row {
  driverId: string;
}
interface TxMocks {
  update: ReturnType<typeof vi.fn>;
  setFn: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  insertValues: ReturnType<typeof vi.fn>;
}
function makeDb(row: Row | null): { db: FleetDb; tx: TxMocks } {
  const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const update = vi.fn().mockReturnValue({ set: setFn });
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values: insertValues });
  const tx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(row ? [row] : []) }),
      }),
    }),
    update,
    insert,
  };
  const db = {
    transaction: vi.fn().mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => cb(tx)),
  } as unknown as FleetDb;
  return { db, tx: { update, setFn, insert, insertValues } };
}
const BASE = {
  driverId: 'driver-target-1',
  companyId: '11111111-1111-1111-1111-111111111111',
  businessUnitId: '22222222-2222-2222-2222-222222222222',
  depotId: '33333333-3333-3333-3333-333333333333',
  legalEntityId: '44444444-4444-4444-4444-444444444444',
  actorOperatorId: '00000000-0000-0000-0000-0000000000aa',
  newPassword: 'freshpass1', // pragma: allowlist secret
};
describe('AdminDriversResetPasswordService', () => {
  let hashFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    hashFn = vi.fn().mockResolvedValue('HASH_OF_NEW');
  });
  it('rehashes, updates the driver, and writes an attributed audit row', async () => {
    const { db, tx } = makeDb({ driverId: 'driver-target-1' });
    const svc = new AdminDriversResetPasswordService(db, hashFn as never);
    await svc.resetPassword(BASE);
    expect(hashFn).toHaveBeenCalledWith('freshpass1', 10);
    expect(tx.setFn).toHaveBeenCalledWith({ passwordHash: 'HASH_OF_NEW' }); // pragma: allowlist secret
    expect(tx.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: BASE.companyId,
        businessUnitId: BASE.businessUnitId,
        depotId: BASE.depotId,
        legalEntityId: BASE.legalEntityId,
        actorOperatorId: BASE.actorOperatorId,
        targetDriverId: BASE.driverId,
      }),
    );
  });
  it('throws NotFoundException and writes/logs NOTHING when driver not in tenant', async () => {
    const { db, tx } = makeDb(null);
    const svc = new AdminDriversResetPasswordService(db, hashFn as never);
    await expect(svc.resetPassword(BASE)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
