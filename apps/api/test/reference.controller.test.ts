// apps/api/test/reference.controller.test.ts
// Unit: ReferenceController delegates to ReferenceService and resolves the
// prefix/role query-param ternaries. Service is mocked; JwtGuard bypassed.
// Covers both sides of: prefix valid-regex vs fallback 'XTT' (peek + allocate),
// and role 'delivery' vs fallback 'pickup' (warehouses).
//
// Mocking style: plain object literal of vi.fn() rather than mockDeep<T>().
// Reason: every assertion uses expect(svc.method).toHaveBeenCalledWith(...),
// which extracts an unbound method reference. With mockDeep<ReferenceService>
// the method is typed as a class method, which trips
// @typescript-eslint/unbound-method in CI. The plain object literal types
// each entry as a plain function property, which the rule permits — and
// matches the convention of every other delegation-style controller test
// in this codebase.
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReferenceController } from '../src/reference/reference.controller.js';
import { ReferenceService } from '../src/reference/reference.service.js';
import { JwtGuard } from '../src/auth/jwt.guard.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-000000000001',
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '00000000-0000-0000-0000-000000000000',
  depotId: '00000000-0000-0000-0000-000000000000',
  legalEntityId: '00000000-0000-0000-0000-000000000000',
};
describe('ReferenceController', () => {
  let controller: ReferenceController;
  const svc = {
    drivers: vi.fn(),
    vehicles: vi.fn(),
    customers: vi.fn(),
    cargoTypes: vi.fn(),
    peekOrderRef: vi.fn(),
    allocateOrderRef: vi.fn(),
    warehouses: vi.fn(),
    driverVehicleAssignments: vi.fn(),
  };
  beforeEach(async () => {
    for (const fn of Object.values(svc)) fn.mockReset();
    const mod = await Test.createTestingModule({
      controllers: [ReferenceController],
      providers: [{ provide: ReferenceService, useValue: svc }],
    })
      .overrideGuard(JwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = mod.get(ReferenceController);
  });
  it('drivers() delegates to the service', async () => {
    svc.drivers.mockResolvedValueOnce({ items: [{ id: 'd1', label: 'Alpha' }] });
    const r = await controller.drivers(OP);
    expect(svc.drivers).toHaveBeenCalledWith(OP);
    expect(r).toEqual({ items: [{ id: 'd1', label: 'Alpha' }] });
  });
  it('vehicles() delegates to the service', async () => {
    svc.vehicles.mockResolvedValueOnce({ items: [] });
    await controller.vehicles(OP);
    expect(svc.vehicles).toHaveBeenCalledWith(OP);
  });
  it('customers() delegates to the service', async () => {
    svc.customers.mockResolvedValueOnce({ items: [] });
    await controller.customers(OP);
    expect(svc.customers).toHaveBeenCalledWith(OP);
  });
  it('cargoTypes() delegates to the service', async () => {
    svc.cargoTypes.mockResolvedValueOnce({ items: [] });
    await controller.cargoTypes(OP);
    expect(svc.cargoTypes).toHaveBeenCalledWith(OP);
  });
  it('peekOrderRef() passes a valid prefix through unchanged', async () => {
    svc.peekOrderRef.mockResolvedValueOnce({ ref: 'TO.001' });
    await controller.peekOrderRef(OP, 'TO');
    expect(svc.peekOrderRef).toHaveBeenCalledWith(OP, 'TO');
  });
  it('peekOrderRef() falls back to XT when prefix is undefined', async () => {
    svc.peekOrderRef.mockResolvedValueOnce({ ref: 'XT.001' });
    await controller.peekOrderRef(OP);
    expect(svc.peekOrderRef).toHaveBeenCalledWith(OP, 'XTT');
  });
  it('peekOrderRef() falls back to XT when prefix fails the regex', async () => {
    svc.peekOrderRef.mockResolvedValueOnce({ ref: 'XT.001' });
    await controller.peekOrderRef(OP, 'to-123');
    expect(svc.peekOrderRef).toHaveBeenCalledWith(OP, 'XTT');
  });
  it('allocateOrderRef() passes a valid prefix through unchanged', async () => {
    svc.allocateOrderRef.mockResolvedValueOnce({ ref: 'TO.001' });
    await controller.allocateOrderRef(OP, 'TO');
    expect(svc.allocateOrderRef).toHaveBeenCalledWith(OP, 'TO');
  });
  it('allocateOrderRef() falls back to XT when prefix is undefined', async () => {
    svc.allocateOrderRef.mockResolvedValueOnce({ ref: 'XT.001' });
    await controller.allocateOrderRef(OP);
    expect(svc.allocateOrderRef).toHaveBeenCalledWith(OP, 'XTT');
  });
  it('allocateOrderRef() falls back to XT when prefix fails the regex', async () => {
    svc.allocateOrderRef.mockResolvedValueOnce({ ref: 'XT.001' });
    await controller.allocateOrderRef(OP, '');
    expect(svc.allocateOrderRef).toHaveBeenCalledWith(OP, 'XTT');
  });
  it('warehouses() maps role=delivery to delivery', async () => {
    svc.warehouses.mockResolvedValueOnce({ items: [] });
    await controller.warehouses(OP, 'delivery');
    expect(svc.warehouses).toHaveBeenCalledWith(OP, 'delivery');
  });
  it('warehouses() maps any other role to pickup', async () => {
    svc.warehouses.mockResolvedValueOnce({ items: [] });
    await controller.warehouses(OP, 'something-else');
    expect(svc.warehouses).toHaveBeenCalledWith(OP, 'pickup');
  });
  it('warehouses() defaults to pickup when role is undefined', async () => {
    svc.warehouses.mockResolvedValueOnce({ items: [] });
    await controller.warehouses(OP);
    expect(svc.warehouses).toHaveBeenCalledWith(OP, 'pickup');
  });
  it('driverVehicleAssignments() delegates to the service', async () => {
    svc.driverVehicleAssignments.mockResolvedValueOnce({
      items: [{ operatorId: 'op-1', vehicleId: 'veh-1' }],
    });
    const r = await controller.driverVehicleAssignments(OP);
    expect(svc.driverVehicleAssignments).toHaveBeenCalledWith(OP);
    expect(r).toEqual({ items: [{ operatorId: 'op-1', vehicleId: 'veh-1' }] });
  });
});
