// apps/api/test/admin-drivers-update.controller.test.ts
// RED: PATCH /admin/drivers/:id renames a driver; DELETE /admin/drivers/:id
// soft-deletes. Tenancy comes from JWT (CurrentOperator) — body cannot carry
// companyId, defending against IDOR.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminDriversUpdateController } from '../src/admin/admin-drivers-update.controller.js';
import type { AdminDriversUpdateService } from '../src/admin/admin-drivers-update.service.js';
import type { OperatorContext } from '@fleet/domain';
const op: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-0000000000aa',
  companyId: '11111111-1111-1111-1111-111111111111',
  businessUnitId: '22222222-2222-2222-2222-222222222222',
  depotId: '33333333-3333-3333-3333-333333333333',
  legalEntityId: '44444444-4444-4444-4444-444444444444',
};
const DRIVER_ID = '55555555-5555-5555-5555-555555555555';
describe('AdminDriversUpdateController', () => {
  let updateFn: ReturnType<typeof vi.fn>;
  let softDeleteFn: ReturnType<typeof vi.fn>;
  let controller: AdminDriversUpdateController;
  beforeEach(() => {
    updateFn = vi.fn().mockResolvedValue(undefined);
    softDeleteFn = vi.fn().mockResolvedValue(undefined);
    controller = new AdminDriversUpdateController({ update: updateFn, softDelete: softDeleteFn } as unknown as AdminDriversUpdateService);
  });
  it('PATCH /admin/drivers/:id renames the driver (companyId from JWT)', async () => {
    await controller.update(op, DRIVER_ID, { fullName: 'NEW NAME' });
    expect(updateFn).toHaveBeenCalledWith({
      driverId: DRIVER_ID,
      companyId: op.companyId,
      fullName: 'NEW NAME',
    });
  });
  it('PATCH /admin/drivers/:id forwards phone when provided', async () => {
    await controller.update(op, DRIVER_ID, { fullName: 'NAME', phone: '+84999999999' });
    expect(updateFn).toHaveBeenCalledWith({
      driverId: DRIVER_ID,
      companyId: op.companyId,
      fullName: 'NAME',
      phone: '+84999999999',
    });
  });
  it('PATCH rejects empty fullName', async () => {
    await expect(controller.update(op, DRIVER_ID, { fullName: '' })).rejects.toThrow();
  });
  it('PATCH rejects body with extraneous companyId (no IDOR via body)', async () => {
    await controller.update(op, DRIVER_ID, { fullName: 'OK', companyId: '99999999-9999-9999-9999-999999999999' } as never);
    expect(updateFn).toHaveBeenCalledWith({
      driverId: DRIVER_ID,
      companyId: op.companyId,
      fullName: 'OK',
    });
  });
  it('DELETE /admin/drivers/:id soft-deletes (companyId from JWT)', async () => {
    await controller.softDelete(op, DRIVER_ID);
    expect(softDeleteFn).toHaveBeenCalledWith({
      driverId: DRIVER_ID,
      companyId: op.companyId,
    });
  });
});
