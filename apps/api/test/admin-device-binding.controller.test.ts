// apps/api/test/admin-device-binding.controller.test.ts
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
// RED (device-binding arc, P5 slice-2e): admin devices controller. GET lists
// company-scoped device rows; PATCH :deviceId/binding activates or revokes.
// Body validated by the SSOT DeviceBindingPatchRequestSchema (revoke requires
// a reason via the strict schema).
import { describe, it, expect, vi } from 'vitest';
import { AdminDeviceBindingController } from '../src/admin/admin-device-binding.controller.js';
import type { AdminDeviceBindingService } from '../src/admin/admin-device-binding.service.js';
import type { OperatorContext } from '@fleet/domain';
const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-0000000000a1',
  companyId: '00000000-0000-0000-0000-000000000001',
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};
const DEVICE_ID = '00000000-0000-0000-0000-0000000000d1';
describe('AdminDeviceBindingController', () => {
  it('GET lists company-scoped devices', async () => {
    const rows = [{ deviceId: DEVICE_ID }];
    const service = { list: vi.fn().mockResolvedValue(rows), setBinding: vi.fn() } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    const r = await ctrl.list(OP);
    expect(r).toEqual({ devices: rows });
    expect(service.list).toHaveBeenCalledWith(OP.companyId);
  });
  it('PATCH activate calls setBinding with the parsed action', async () => {
    const service = { list: vi.fn(), setBinding: vi.fn().mockResolvedValue(undefined) } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    const r = await ctrl.patch(OP, DEVICE_ID, { action: 'activate' });
    expect(r).toEqual({ ok: true });
    expect(service.setBinding).toHaveBeenCalledWith(OP.companyId, DEVICE_ID, { action: 'activate' });
  });
  it('PATCH revoke passes the reason through', async () => {
    const service = { list: vi.fn(), setBinding: vi.fn().mockResolvedValue(undefined) } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    await ctrl.patch(OP, DEVICE_ID, { action: 'revoke', revokedReason: 'stolen' });
    expect(service.setBinding).toHaveBeenCalledWith(OP.companyId, DEVICE_ID, { action: 'revoke', revokedReason: 'stolen' });
  });
  it('PATCH rejects an invalid action via zod', async () => {
    const service = { list: vi.fn(), setBinding: vi.fn() } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    await expect(ctrl.patch(OP, DEVICE_ID, { action: 'delete' } as never)).rejects.toThrow();
    expect(service.setBinding).not.toHaveBeenCalled();
  });
  it('PATCH rejects an unsafe deviceId param via zod', async () => {
    const service = { list: vi.fn(), setBinding: vi.fn() } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    await expect(ctrl.patch(OP, 'not-a-guid', { action: 'activate' })).rejects.toThrow();
  });
});
