// apps/api/test/driver-password-change.controller.test.ts
// outside-in strict TDD RED (L0): self-service password change.
// Business invariant: a driver changes their OWN password from the driver
// app. They must prove possession of the CURRENT password (defense against a
// hijacked unlocked session silently rotating credentials), and the new
// password is rehashed (bcrypt) and persisted. The controller is JWT-guarded
// and derives identity from the token (operatorId + companyId), never from the
// body — so a forged body cannot target another driver.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DriverPasswordChangeController } from '../src/driver/driver-password-change.controller.js';
import type { DriverPasswordChangeService } from '../src/driver/driver-password-change.service.js';
import type { OperatorContext } from '@fleet/domain';
describe('DriverPasswordChangeController', () => {
  let changeFn: ReturnType<typeof vi.fn>;
  let controller: DriverPasswordChangeController;
  const op: OperatorContext = {
    operatorId: '00000000-0000-0000-0000-0000000000aa',
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };
  beforeEach(() => {
    changeFn = vi.fn();
    controller = new DriverPasswordChangeController({
      changePassword: changeFn,
    } as unknown as DriverPasswordChangeService);
  });
  it('delegates to service with operator identity + both passwords', async () => {
    changeFn.mockResolvedValue(undefined);
    await controller.change(op, { currentPassword: 'oldpass1', newPassword: 'newpass2' }); // pragma: allowlist secret
    expect(changeFn).toHaveBeenCalledWith({
      operatorId: op.operatorId,
      companyId: op.companyId,
      currentPassword: 'oldpass1', // pragma: allowlist secret
      newPassword: 'newpass2', // pragma: allowlist secret
    });
  });
  it('rejects a newPassword shorter than 6 chars (zod) before hitting the service', async () => {
    await expect(
      controller.change(op, { currentPassword: 'oldpass1', newPassword: 'x' }), // pragma: allowlist secret
    ).rejects.toThrow();
    expect(changeFn).not.toHaveBeenCalled();
  });
  it('rejects a missing currentPassword before hitting the service', async () => {
    await expect(
      controller.change(op, { newPassword: 'newpass2' } as unknown as {
        currentPassword: string;
        newPassword: string;
      }), // pragma: allowlist secret
    ).rejects.toThrow();
    expect(changeFn).not.toHaveBeenCalled();
  });
});
