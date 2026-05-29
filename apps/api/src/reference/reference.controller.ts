// apps/api/src/reference/reference.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { ReferenceService, type DriverVehicleAssignmentsResponse } from './reference.service.js';
import type { ReferenceListResponse } from './reference.dto.js';
// Body shape for create/update of dispatch-form master data. A single
// optional 'role' lets warehouse reuse the same DTO; non-warehouse entities
// ignore it. 'name' carries the customer name / cargo name / vehicle plate /
// warehouse name depending on the endpoint.
interface ReferenceWriteDto {
  name: string;
  role?: string;
}
@Controller('reference')
@UseGuards(JwtGuard)
export class ReferenceController {
  constructor(private readonly svc: ReferenceService) {}
  @Get('drivers')   drivers(@CurrentOperator() op: OperatorContext): Promise<ReferenceListResponse> { return this.svc.drivers(op); }
  @Get('vehicles')  vehicles(@CurrentOperator() op: OperatorContext, @Query('scope') scope?: string): Promise<ReferenceListResponse> { return scope === 'admin' ? this.svc.vehiclesAdmin(op) : this.svc.vehicles(op); }
  @Get('customers') customers(@CurrentOperator() op: OperatorContext): Promise<ReferenceListResponse> { return this.svc.customers(op); }
  @Get('cargo-types') cargoTypes(@CurrentOperator() op: OperatorContext): Promise<ReferenceListResponse> { return this.svc.cargoTypes(op); }
  // Driver↔Vehicle active pairings (operatorId↔vehicleId) for the dispatch
  // form's bidirectional auto-fill between Số xe and Tài xế.
  @Get('driver-vehicle-assignments')
  driverVehicleAssignments(@CurrentOperator() op: OperatorContext): Promise<DriverVehicleAssignmentsResponse> {
    return this.svc.driverVehicleAssignments(op);
  }
  @Get('peek-order-ref')
  peekOrderRef(@CurrentOperator() op: OperatorContext, @Query('prefix') prefix?: string): Promise<{ ref: string }> {
    return this.svc.peekOrderRef(op, prefix && /^[A-Z]{1,8}$/.test(prefix) ? prefix : 'XTT');
  }
  @Post('allocate-order-ref')
  allocateOrderRef(@CurrentOperator() op: OperatorContext, @Query('prefix') prefix?: string): Promise<{ ref: string }> {
    return this.svc.allocateOrderRef(op, prefix && /^[A-Z]{1,8}$/.test(prefix) ? prefix : 'XTT');
  }
  @Get('warehouses') warehouses(@CurrentOperator() op: OperatorContext, @Query('role') role?: string): Promise<ReferenceListResponse> {
    const r = role === 'delivery' ? 'delivery' : 'pickup';
    return this.svc.warehouses(op, r);
  }
  // --- CRUD: customers ---------------------------------------------------
  @Post('customers')
  createCustomer(@CurrentOperator() op: OperatorContext, @Body() body: ReferenceWriteDto): Promise<{ id: string; label: string }> {
    return this.svc.createCustomer(op, body.name);
  }
  @Patch('customers/:id')
  updateCustomer(@CurrentOperator() op: OperatorContext, @Param('id') id: string, @Body() body: ReferenceWriteDto): Promise<void> {
    return this.svc.updateCustomer(op, id, body.name);
  }
  @Delete('customers/:id')
  deleteCustomer(@CurrentOperator() op: OperatorContext, @Param('id') id: string): Promise<void> {
    return this.svc.deleteCustomer(op, id);
  }
  // --- CRUD: cargo types -------------------------------------------------
  @Post('cargo-types')
  createCargoType(@CurrentOperator() op: OperatorContext, @Body() body: ReferenceWriteDto): Promise<{ id: string; label: string }> {
    return this.svc.createCargoType(op, body.name);
  }
  @Patch('cargo-types/:id')
  updateCargoType(@CurrentOperator() op: OperatorContext, @Param('id') id: string, @Body() body: ReferenceWriteDto): Promise<void> {
    return this.svc.updateCargoType(op, id, body.name);
  }
  @Delete('cargo-types/:id')
  deleteCargoType(@CurrentOperator() op: OperatorContext, @Param('id') id: string): Promise<void> {
    return this.svc.deleteCargoType(op, id);
  }
  // --- CRUD: vehicles ----------------------------------------------------
  @Post('vehicles')
  createVehicle(@CurrentOperator() op: OperatorContext, @Body() body: ReferenceWriteDto): Promise<{ id: string; label: string }> {
    return this.svc.createVehicle(op, body.name);
  }
  @Patch('vehicles/:id')
  updateVehicle(@CurrentOperator() op: OperatorContext, @Param('id') id: string, @Body() body: ReferenceWriteDto): Promise<void> {
    return this.svc.updateVehicle(op, id, body.name);
  }
  @Delete('vehicles/:id')
  deleteVehicle(@CurrentOperator() op: OperatorContext, @Param('id') id: string): Promise<void> {
    return this.svc.deleteVehicle(op, id);
  }
  // --- CRUD: warehouses --------------------------------------------------
  @Post('warehouses')
  createWarehouse(@CurrentOperator() op: OperatorContext, @Body() body: ReferenceWriteDto): Promise<{ id: string; label: string }> {
    const role = body.role === 'delivery' ? 'delivery' : 'pickup';
    return this.svc.createWarehouse(op, body.name, role);
  }
  @Patch('warehouses/:id')
  updateWarehouse(@CurrentOperator() op: OperatorContext, @Param('id') id: string, @Body() body: ReferenceWriteDto): Promise<void> {
    return this.svc.updateWarehouse(op, id, body.name);
  }
  @Delete('warehouses/:id')
  deleteWarehouse(@CurrentOperator() op: OperatorContext, @Param('id') id: string): Promise<void> {
    return this.svc.deleteWarehouse(op, id);
  }
}
