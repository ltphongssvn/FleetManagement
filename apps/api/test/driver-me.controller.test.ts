// apps/api/test/driver-me.controller.test.ts
// RED: GET /driver/me returns driver record + assigned vehicle (1:1).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DriverMeController } from '../src/driver/driver-me.controller.js';
import type { DriverMeService } from '../src/driver/driver-me.service.js';
import type { OperatorContext } from '@fleet/domain';

describe('DriverMeController', () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let controller: DriverMeController;
  const op: OperatorContext = {
    operatorId: '00000000-0000-0000-0000-0000000000aa',
    companyId: '11111111-1111-1111-1111-111111111111',
    businessUnitId: '22222222-2222-2222-2222-222222222222',
    depotId: '33333333-3333-3333-3333-333333333333',
    legalEntityId: '44444444-4444-4444-4444-444444444444',
  };

  beforeEach(() => {
    fetchFn = vi.fn();
    controller = new DriverMeController({ fetchMe: fetchFn } as unknown as DriverMeService);
  });

  it('returns driver + assignedVehicle for authenticated operator', async () => {
    fetchFn.mockResolvedValue({
      driver: { driverId: 'd1', fullName: 'Nguyễn Văn A' },
      assignedVehicle: { vehicleId: 'v1', plate: '51A-12345' },
    });
    const result = await controller.me(op);
    expect(result.driver.fullName).toBe('Nguyễn Văn A');
    expect(result.assignedVehicle?.plate).toBe('51A-12345');
    expect(fetchFn).toHaveBeenCalledWith({ operatorId: op.operatorId, companyId: op.companyId });
  });

  it('returns null assignedVehicle when no active assignment exists', async () => {
    fetchFn.mockResolvedValue({
      driver: { driverId: 'd1', fullName: 'Nguyễn Văn A' },
      assignedVehicle: null,
    });
    const result = await controller.me(op);
    expect(result.assignedVehicle).toBeNull();
  });
});
