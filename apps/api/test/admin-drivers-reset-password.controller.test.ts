// apps/api/test/admin-drivers-reset-password.controller.test.ts
// outside-in strict TDD RED (L0): admin/service-desk password reset.
// Distinct from self-service change: NO current password is required (the
// driver lost it / forgot it — that is the whole point of a service-desk
// reset). Per 2026 best practice the reset MUST be audit-logged: who (the
// admin actor's operatorId from JWT) reset whom (target driverId) and when.
// Tenancy + actor identity come from the token via CurrentOperator, never the
// body, so a forged body cannot target another tenant or spoof the actor.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminDriversResetPasswordController } from '../src/admin/admin-drivers-reset-password.controller.js';
import type { AdminDriversResetPasswordService } from '../src/admin/admin-drivers-reset-password.service.js';
import type { OperatorContext } from '@fleet/domain';
describe('AdminDriversResetPasswordController', () => {
  let resetFn: ReturnType<typeof vi.fn>;
  let controller: AdminDriversResetPasswordController;
  const op: OperatorContext = {
    operatorId: '00000000-0000-0000-0000-0000000000aa',
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };
  beforeEach(() => {
    resetFn = vi.fn();
    controller = new AdminDriversResetPasswordController({ resetPassword: resetFn } as unknown as AdminDriversResetPasswordService);
  });
  it('delegates with target driverId, actor operatorId, tenancy + newPassword', async () => {
    resetFn.mockResolvedValue(undefined);
    await controller.reset(op, 'driver-target-1', { newPassword: 'freshpass1' });
    expect(resetFn).toHaveBeenCalledWith({
      driverId: 'driver-target-1',
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
      actorOperatorId: op.operatorId,
      newPassword: 'freshpass1',
    });
  });
  it('rejects a newPassword shorter than 6 chars (zod) before hitting the service', async () => {
    await expect(
      controller.reset(op, 'driver-target-1', { newPassword: 'x' }),
    ).rejects.toThrow();
    expect(resetFn).not.toHaveBeenCalled();
  });
  it('does NOT accept a currentPassword field (service-desk reset needs none)', async () => {
    resetFn.mockResolvedValue(undefined);
    await controller.reset(op, 'driver-target-1', { newPassword: 'freshpass1', currentPassword: 'whatever' } as unknown as { newPassword: string });
    // zod strips unknown keys: the service call must carry only the reset shape
    expect(resetFn).toHaveBeenCalledWith({
      driverId: 'driver-target-1',
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
      actorOperatorId: op.operatorId,
      newPassword: 'freshpass1',
    });
  });
});
