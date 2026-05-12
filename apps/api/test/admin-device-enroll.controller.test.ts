// apps/api/test/admin-device-enroll.controller.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdminDeviceEnrollController } from '../src/admin/admin-device-enroll.controller.js';
import type { AdminDeviceEnrollService } from '../src/admin/admin-device-enroll.service.js';
import type { OperatorContext } from '@fleet/domain';

describe('AdminDeviceEnrollController', () => {
  let enrollFn: ReturnType<typeof vi.fn>;
  let controller: AdminDeviceEnrollController;
  const op: OperatorContext = {
    operatorId: '00000000-0000-0000-0000-0000000000aa',
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };

  beforeEach(() => {
    enrollFn = vi.fn();
    controller = new AdminDeviceEnrollController({ enroll: enrollFn } as unknown as AdminDeviceEnrollService);
  });

  it('POST /admin/devices enrolls device for driver', async () => {
    enrollFn.mockResolvedValue({ deviceId: 'dev-1', udid: '00008110-000624200CFA201E' });
    const r = await controller.create(op, {
      driverId: '55555555-5555-5555-5555-555555555555',
      udid: '00008110-000624200CFA201E',
      platform: 'ios',
    });
    expect(r.deviceId).toBe('dev-1');
    expect(enrollFn).toHaveBeenCalledWith({
      driverId: '55555555-5555-5555-5555-555555555555',
      udid: '00008110-000624200CFA201E',
      platform: 'ios',
      companyId: op.companyId,
    });
  });
});
