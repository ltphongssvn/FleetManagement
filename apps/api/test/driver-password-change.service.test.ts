// apps/api/test/driver-password-change.service.test.ts
// outside-in strict TDD (L1): the service invariant beneath the L0 contract.
// Verifies the security behavior the controller delegates: (1) the CURRENT
// password is checked via bcryptCompare against the stored hash; (2) on
// mismatch it throws UnauthorizedException and NEVER writes; (3) on match the
// NEW password is bcrypt-rehashed and persisted scoped to operatorId+companyId;
// (4) an unknown operator throws and never writes. bcrypt seams are injected
// fakes so the test is deterministic and never runs real hashing.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { DriverPasswordChangeService } from '../src/driver/driver-password-change.service.js';
import type { FleetDb } from '../src/database/database.module.js';
interface Row { driverId: string; operatorId: string; companyId: string; passwordHash: string }
function makeDb(row: Row | null): { db: FleetDb; update: ReturnType<typeof vi.fn>; setFn: ReturnType<typeof vi.fn>; setWhere: { where: ReturnType<typeof vi.fn> } } {
  const update = vi.fn();
  const setWhere = { where: vi.fn().mockResolvedValue(undefined) };
  const setFn = vi.fn().mockReturnValue(setWhere);
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(row ? [row] : []),
        }),
      }),
    }),
    update: update.mockReturnValue({ set: setFn }),
  } as unknown as FleetDb;
  return { db, update, setFn, setWhere };
}
const OP = '00000000-0000-0000-0000-0000000000aa';
const CO = '11111111-1111-1111-1111-111111111111';
const ROW: Row = { driverId: 'd1', operatorId: OP, companyId: CO, passwordHash: 'HASH_OF_OLD' };
describe('DriverPasswordChangeService', () => {
  let compareFn: ReturnType<typeof vi.fn>;
  let hashFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    compareFn = vi.fn();
    hashFn = vi.fn();
  });
  it('rehashes + persists the new password when current password matches', async () => {
    compareFn.mockResolvedValue(true);
    hashFn.mockResolvedValue('HASH_OF_NEW');
    const { db, setFn } = makeDb(ROW);
    const svc = new DriverPasswordChangeService(db, hashFn as never, compareFn as never);
    await svc.changePassword({ operatorId: OP, companyId: CO, currentPassword: 'oldpass1', newPassword: 'newpass2' });
    expect(compareFn).toHaveBeenCalledWith('oldpass1', 'HASH_OF_OLD');
    expect(hashFn).toHaveBeenCalledWith('newpass2', 10);
    expect(setFn).toHaveBeenCalledWith({ passwordHash: 'HASH_OF_NEW' });
  });
  it('throws UnauthorizedException and does NOT write when current password is wrong', async () => {
    compareFn.mockResolvedValue(false);
    const { db, update } = makeDb(ROW);
    const svc = new DriverPasswordChangeService(db, hashFn as never, compareFn as never);
    await expect(
      svc.changePassword({ operatorId: OP, companyId: CO, currentPassword: 'wrong', newPassword: 'newpass2' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(hashFn).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('throws UnauthorizedException and does NOT write when driver has a null passwordHash', async () => {
    const { db, update } = makeDb({ driverId: 'd1', operatorId: OP, companyId: CO, passwordHash: null as unknown as string });
    const svc = new DriverPasswordChangeService(db, hashFn as never, compareFn as never);
    await expect(
      svc.changePassword({ operatorId: OP, companyId: CO, currentPassword: 'oldpass1', newPassword: 'newpass2' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(compareFn).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('throws UnauthorizedException and does NOT write when operator has no driver row', async () => {
    const { db, update } = makeDb(null);
    const svc = new DriverPasswordChangeService(db, hashFn as never, compareFn as never);
    await expect(
      svc.changePassword({ operatorId: OP, companyId: CO, currentPassword: 'oldpass1', newPassword: 'newpass2' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(compareFn).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
