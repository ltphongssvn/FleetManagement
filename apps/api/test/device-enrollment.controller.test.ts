// apps/api/test/device-enrollment.controller.test.ts
// RED: POST /devices/enroll returns deviceId for the authenticated operator.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeviceEnrollmentController } from '../src/device/device-enrollment.controller.js';
import type { DeviceEnrollmentService } from '../src/device/device-enrollment.service.js';
import type { OperatorContext } from '@fleet/domain';

describe('DeviceEnrollmentController', () => {
  let enrollFn: ReturnType<typeof vi.fn>;
  let controller: DeviceEnrollmentController;
  const op: OperatorContext = {
    operatorId: '00000000-0000-0000-0000-0000000000aa',
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };

  beforeEach(() => {
    enrollFn = vi.fn();
    controller = new DeviceEnrollmentController({ enroll: enrollFn } as unknown as DeviceEnrollmentService);
  });

  it('POST /devices/enroll returns deviceId from service', async () => {
    enrollFn.mockResolvedValue({ deviceId: 'dev-xyz' });
    const result = await controller.enroll(op, { platform: 'ios', appVersion: '0.1.0' });
    expect(result).toEqual({ deviceId: 'dev-xyz' });
    expect(enrollFn).toHaveBeenCalledWith({
      operatorId: op.operatorId,
      platform: 'ios',
      appVersion: '0.1.0',
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
      });
  });

  it('passes optional expoPushToken through', async () => {
    enrollFn.mockResolvedValue({ deviceId: 'dev-xyz' });
    await controller.enroll(op, { platform: 'android', appVersion: '0.1.0', expoPushToken: 'ExponentPushToken[abc]' });
    expect(enrollFn).toHaveBeenCalledWith(expect.objectContaining({ expoPushToken: 'ExponentPushToken[abc]' }));
  });
});
