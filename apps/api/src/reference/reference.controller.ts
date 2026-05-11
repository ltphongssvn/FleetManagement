// apps/api/src/reference/reference.controller.ts
import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { ReferenceService } from './reference.service.js';
import type { ReferenceListResponse } from './reference.dto.js';
@Controller('reference')
@UseGuards(JwtGuard)
export class ReferenceController {
  constructor(private readonly svc: ReferenceService) {}
  @Get('drivers')   drivers(@CurrentOperator() op: OperatorContext): Promise<ReferenceListResponse> { return this.svc.drivers(op); }
  @Get('vehicles')  vehicles(@CurrentOperator() op: OperatorContext): Promise<ReferenceListResponse> { return this.svc.vehicles(op); }
  @Get('customers') customers(@CurrentOperator() op: OperatorContext): Promise<ReferenceListResponse> { return this.svc.customers(op); }
  @Get('cargo-types') cargoTypes(@CurrentOperator() op: OperatorContext): Promise<ReferenceListResponse> { return this.svc.cargoTypes(op); }
  @Get('peek-order-ref')
  peekOrderRef(@CurrentOperator() op: OperatorContext, @Query('prefix') prefix?: string): Promise<{ ref: string }> {
    return this.svc.peekOrderRef(op, prefix && /^[A-Z]{1,8}$/.test(prefix) ? prefix : 'XT');
  }
  @Post('allocate-order-ref')
  allocateOrderRef(@CurrentOperator() op: OperatorContext, @Query('prefix') prefix?: string): Promise<{ ref: string }> {
    return this.svc.allocateOrderRef(op, prefix && /^[A-Z]{1,8}$/.test(prefix) ? prefix : 'XT');
  }
  @Get('warehouses') warehouses(@CurrentOperator() op: OperatorContext, @Query('role') role?: string): Promise<ReferenceListResponse> {
    const r = role === 'delivery' ? 'delivery' : 'pickup';
    return this.svc.warehouses(op, r);
  }
}
