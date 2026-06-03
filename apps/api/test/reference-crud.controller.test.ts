// apps/api/test/reference-crud.controller.test.ts
// Unit: ReferenceController CRUD endpoints delegate to ReferenceService.
// Service mocked, JwtGuard bypassed. Covers create/update/delete for
// customer, cargoType, vehicle, warehouse (warehouse carries a role).
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
describe('ReferenceController CRUD', () => {
  let controller: ReferenceController;
  const svc = {
    createCustomer: vi.fn(), updateCustomer: vi.fn(), deleteCustomer: vi.fn(),
    createCargoType: vi.fn(), updateCargoType: vi.fn(), deleteCargoType: vi.fn(),
    createVehicle: vi.fn(), updateVehicle: vi.fn(), deleteVehicle: vi.fn(),
    createWarehouse: vi.fn(), updateWarehouse: vi.fn(), deleteWarehouse: vi.fn(),
  };
  beforeEach(async () => {
    for (const fn of Object.values(svc)) fn.mockReset();
    const mod = await Test.createTestingModule({
      controllers: [ReferenceController],
      providers: [{ provide: ReferenceService, useValue: svc }],
    }).overrideGuard(JwtGuard).useValue({ canActivate: () => true }).compile();
    controller = mod.get(ReferenceController);
  });
  it('createCustomer delegates with the name', async () => {
    svc.createCustomer.mockResolvedValueOnce({ id: 'c1', label: 'Acme' });
    const r = await controller.createCustomer(OP, { name: 'Acme' });
    expect(svc.createCustomer).toHaveBeenCalledWith(OP, 'Acme', undefined);
    expect(r).toEqual({ id: 'c1', label: 'Acme' });
  });
  it('updateCustomer delegates with id + name', async () => {
    await controller.updateCustomer(OP, 'c1', { name: 'Acme Corp' });
    expect(svc.updateCustomer).toHaveBeenCalledWith(OP, 'c1', 'Acme Corp', undefined);
  });
  it('deleteCustomer delegates with id', async () => {
    await controller.deleteCustomer(OP, 'c1');
    expect(svc.deleteCustomer).toHaveBeenCalledWith(OP, 'c1');
  });
  it('createCustomer delegates with name + phone (Số điện thoại)', async () => {
    svc.createCustomer.mockResolvedValueOnce({ id: 'c2', label: 'Acme' });
    await controller.createCustomer(OP, { name: 'Acme', phone: '0901234567' });
    expect(svc.createCustomer).toHaveBeenCalledWith(OP, 'Acme', '0901234567');
  });
  it('updateCustomer delegates with id + name + phone', async () => {
    await controller.updateCustomer(OP, 'c1', { name: 'Acme', phone: '0902222222' });
    expect(svc.updateCustomer).toHaveBeenCalledWith(OP, 'c1', 'Acme', '0902222222');
  });
  it('createCargoType delegates with the name', async () => {
    svc.createCargoType.mockResolvedValueOnce({ id: 'g1', label: 'Rice' });
    await controller.createCargoType(OP, { name: 'Rice' });
    expect(svc.createCargoType).toHaveBeenCalledWith(OP, 'Rice');
  });
  it('updateCargoType delegates with id + name', async () => {
    await controller.updateCargoType(OP, 'g1', { name: 'Jasmine Rice' });
    expect(svc.updateCargoType).toHaveBeenCalledWith(OP, 'g1', 'Jasmine Rice');
  });
  it('deleteCargoType delegates with id', async () => {
    await controller.deleteCargoType(OP, 'g1');
    expect(svc.deleteCargoType).toHaveBeenCalledWith(OP, 'g1');
  });
  it('createVehicle delegates with the plate', async () => {
    svc.createVehicle.mockResolvedValueOnce({ id: 'v1', label: '62H-1' });
    await controller.createVehicle(OP, { name: '62H-1' });
    expect(svc.createVehicle).toHaveBeenCalledWith(OP, '62H-1');
  });
  it('updateVehicle delegates with id + plate', async () => {
    await controller.updateVehicle(OP, 'v1', { name: '62H-2' });
    expect(svc.updateVehicle).toHaveBeenCalledWith(OP, 'v1', '62H-2');
  });
  it('deleteVehicle delegates with id', async () => {
    await controller.deleteVehicle(OP, 'v1');
    expect(svc.deleteVehicle).toHaveBeenCalledWith(OP, 'v1');
  });
  it('createWarehouse delegates with name + role (delivery)', async () => {
    svc.createWarehouse.mockResolvedValueOnce({ id: 'w1', label: 'Bay' });
    await controller.createWarehouse(OP, { name: 'Bay', role: 'delivery' });
    expect(svc.createWarehouse).toHaveBeenCalledWith(OP, 'Bay', 'delivery');
  });
  it('createWarehouse defaults role to pickup when omitted', async () => {
    svc.createWarehouse.mockResolvedValueOnce({ id: 'w2', label: 'Dock' });
    await controller.createWarehouse(OP, { name: 'Dock' });
    expect(svc.createWarehouse).toHaveBeenCalledWith(OP, 'Dock', 'pickup');
  });
  it('updateWarehouse delegates with id + name', async () => {
    await controller.updateWarehouse(OP, 'w1', { name: 'Bay 2' });
    expect(svc.updateWarehouse).toHaveBeenCalledWith(OP, 'w1', 'Bay 2');
  });
  it('deleteWarehouse delegates with id', async () => {
    await controller.deleteWarehouse(OP, 'w1');
    expect(svc.deleteWarehouse).toHaveBeenCalledWith(OP, 'w1');
  });
});
