// apps/api/src/reference/reference.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { UuidParamSchema } from '../common/uuid-param.schema.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { ReferenceService, type DriverVehicleAssignmentsResponse } from './reference.service.js';
import { ReferenceWriteSchema } from './reference.dto.js';
import type { ReferenceListResponse } from './reference.dto.js';
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
  createCustomer(@CurrentOperator() op: OperatorContext, @Body() body: unknown): Promise<{ id: string; label: string }> {
    const dto = ReferenceWriteSchema.parse(body);
    return this.svc.createCustomer(op, dto.name, dto.phone);
  }
  @Patch('customers/:id')
  updateCustomer(@CurrentOperator() op: OperatorContext, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const dto = ReferenceWriteSchema.parse(body);
    return this.svc.updateCustomer(op, UuidParamSchema.parse(id), dto.name, dto.phone);
  }
  @Delete('customers/:id')
  deleteCustomer(@CurrentOperator() op: OperatorContext, @Param('id') id: string): Promise<void> {
    return this.svc.deleteCustomer(op, UuidParamSchema.parse(id));
  }
  // --- CRUD: cargo types -------------------------------------------------
  @Post('cargo-types')
  createCargoType(@CurrentOperator() op: OperatorContext, @Body() body: unknown): Promise<{ id: string; label: string }> {
    const dto = ReferenceWriteSchema.parse(body);
    return this.svc.createCargoType(op, dto.name);
  }
  @Patch('cargo-types/:id')
  updateCargoType(@CurrentOperator() op: OperatorContext, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const dto = ReferenceWriteSchema.parse(body);
    return this.svc.updateCargoType(op, UuidParamSchema.parse(id), dto.name);
  }
  @Delete('cargo-types/:id')
  deleteCargoType(@CurrentOperator() op: OperatorContext, @Param('id') id: string): Promise<void> {
    return this.svc.deleteCargoType(op, UuidParamSchema.parse(id));
  }
  // --- CRUD: vehicles ----------------------------------------------------
  @Post('vehicles')
  createVehicle(@CurrentOperator() op: OperatorContext, @Body() body: unknown): Promise<{ id: string; label: string }> {
    const dto = ReferenceWriteSchema.parse(body);
    return this.svc.createVehicle(op, dto.name);
  }
  @Patch('vehicles/:id')
  updateVehicle(@CurrentOperator() op: OperatorContext, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const dto = ReferenceWriteSchema.parse(body);
    return this.svc.updateVehicle(op, UuidParamSchema.parse(id), dto.name);
  }
  @Delete('vehicles/:id')
  deleteVehicle(@CurrentOperator() op: OperatorContext, @Param('id') id: string): Promise<void> {
    return this.svc.deleteVehicle(op, UuidParamSchema.parse(id));
  }
  // --- CRUD: warehouses --------------------------------------------------
  @Post('warehouses')
  createWarehouse(@CurrentOperator() op: OperatorContext, @Body() body: unknown): Promise<{ id: string; label: string }> {
    const dto = ReferenceWriteSchema.parse(body);
    return this.svc.createWarehouse(op, dto.name, dto.role ?? 'pickup');
  }
  @Patch('warehouses/:id')
  updateWarehouse(@CurrentOperator() op: OperatorContext, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    const dto = ReferenceWriteSchema.parse(body);
    return this.svc.updateWarehouse(op, UuidParamSchema.parse(id), dto.name);
  }
  @Delete('warehouses/:id')
  deleteWarehouse(@CurrentOperator() op: OperatorContext, @Param('id') id: string): Promise<void> {
    return this.svc.deleteWarehouse(op, UuidParamSchema.parse(id));
  }
}
