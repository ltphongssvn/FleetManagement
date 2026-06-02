// apps/api/test/password-bcrypt-default-seam.test.ts
// outside-in strict TDD RED (L1): both password services take @Optional()
// bcrypt seams (BCRYPT_HASH / BCRYPT_COMPARE) that fall back to the real
// bcryptjs defaults via `?? defaultBcrypt*`. The full coverage run always
// injects fakes, so the default-fallback branch (constructed WITHOUT the
// provider) is never exercised -- dropping branch/function coverage below the
// 90 gate. These tests construct each service with ONLY the db arg, proving
// the real default seam is wired and functional (hash verifies, compare works).
import { describe, it, expect, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { AdminDriversResetPasswordService } from '../src/admin/admin-drivers-reset-password.service.js';
import { DriverPasswordChangeService } from '../src/driver/driver-password-change.service.js';
import type { FleetDb } from '../src/database/database.module.js';
// Minimal tx-mock: reset-password runs select->update->insert in one tx.
function makeResetDb(): FleetDb {
  const tx = {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ driverId: 'd1' }]) }) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  };
  return { transaction: vi.fn(async (cb: (t: unknown) => Promise<void>) => { await cb(tx); }) } as unknown as FleetDb;
}
// change-password reads the driver row (select->from->where) then updates.
function makeChangeDb(passwordHash: string): FleetDb {
  return {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ driverId: 'd1', operatorId: 'op1', companyId: 'co1', passwordHash }]) }) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  } as unknown as FleetDb;
}
describe('bcrypt default seam (no provider injected)', () => {
  it('AdminDriversResetPasswordService rehashes via the real default bcrypt seam', async () => {
    const svc = new AdminDriversResetPasswordService(makeResetDb());
    await expect(svc.resetPassword({
      actorOperatorId: 'op-actor', companyId: 'co1', businessUnitId: 'bu1',
      depotId: 'dp1', legalEntityId: 'le1', driverId: 'd1', newPassword: 'freshpass1', // pragma: allowlist secret
    })).resolves.toBeUndefined();
  });
  it('DriverPasswordChangeService verifies + rehashes via the real default seams', async () => {
    // Seed a real bcrypt hash of the current password so the default compare passes.
    const currentHash = await bcrypt.hash('oldpass1', 10); // pragma: allowlist secret
    const svc = new DriverPasswordChangeService(makeChangeDb(currentHash));
    await expect(svc.changePassword({
      operatorId: 'op1', companyId: 'co1', currentPassword: 'oldpass1', newPassword: 'newpass2', // pragma: allowlist secret
    })).resolves.toBeUndefined();
  });
});
