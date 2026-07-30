// apps/api/test/admin-device-binding.controller.test.ts
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock method references are safe */
// device-binding arc, P7 slice-A: GET /admin/devices is a filtered, paginated
// collection. The controller parses raw query params through the SSOT
// AdminDeviceListQuerySchema (Axis-1 trust boundary) and returns the service
// envelope directly. PATCH :deviceId/binding activates or revokes (body via the
// strict DeviceBindingPatchRequestSchema; deviceId a guid at the boundary).
import { describe, it, expect, vi } from 'vitest';
import { AdminDeviceBindingController } from '../src/admin/admin-device-binding.controller.js';
import type { AdminDeviceBindingService } from '../src/admin/admin-device-binding.service.js';
import type { OperatorContext } from '@fleet/domain';
import { ADMIN_DEVICE_PAGE_SIZE_DEFAULT } from '@fleet/sync-protocol';
const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-0000000000a1',
  companyId: '00000000-0000-0000-0000-000000000001',
  businessUnitId: '00000000-0000-0000-0000-000000000002',
  depotId: '00000000-0000-0000-0000-000000000003',
  legalEntityId: '00000000-0000-0000-0000-000000000004',
};
const DEVICE_ID = '00000000-0000-0000-0000-0000000000d1';
const EMPTY_PAGE = { data: [], page: 1, pageSize: ADMIN_DEVICE_PAGE_SIZE_DEFAULT, total: 0, totalPages: 0, hasMore: false };
describe('AdminDeviceBindingController', () => {
  it('GET parses default query (status pending) and returns the service envelope', async () => {
    const service = { list: vi.fn().mockResolvedValue(EMPTY_PAGE), setBinding: vi.fn() } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    const r = await ctrl.list(OP, {});
    expect(r).toEqual(EMPTY_PAGE);
    expect(service.list).toHaveBeenCalledWith(OP.companyId, { status: 'pending', page: 1, pageSize: ADMIN_DEVICE_PAGE_SIZE_DEFAULT });
  });
  it('GET coerces + forwards explicit status/page/pageSize query params', async () => {
    const service = { list: vi.fn().mockResolvedValue(EMPTY_PAGE), setBinding: vi.fn() } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    await ctrl.list(OP, { status: 'active', page: '2', pageSize: '5' });
    expect(service.list).toHaveBeenCalledWith(OP.companyId, { status: 'active', page: 2, pageSize: 5 });
  });
  it('GET rejects an unknown status query value via zod', async () => {
    const service = { list: vi.fn(), setBinding: vi.fn() } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    await expect(ctrl.list(OP, { status: 'approved' })).rejects.toThrow();
    expect(service.list).not.toHaveBeenCalled();
  });
  it('GET rejects a stray query key via strict zod', async () => {
    const service = { list: vi.fn(), setBinding: vi.fn() } as unknown as AdminDeviceBindingService;
    const ctrl = new AdminDeviceBindingController(service);
    await expect(ctrl.list(OP, { statuss: 'pending' })).rejects.toThrow();
    expect(service.list).not.toHaveBeenCalled();
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
