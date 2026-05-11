// apps/api/src/transport-orders/transport-orders.controller.ts
// Pilot seed endpoint. Disabled unless FLEET_PILOT_SEED_ENABLED=true.
import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { CreateTransportOrderSchema, type CreateTransportOrderResponse, type ListAssignedResponse } from './transport-orders.dto.js';
import { TransportOrdersService } from './transport-orders.service.js';

@Controller('transport-orders')
@UseGuards(JwtGuard)
export class TransportOrdersController {
  constructor(private readonly svc: TransportOrdersService) {}

  @Post()
  async create(@Body() body: unknown, @CurrentOperator() op: OperatorContext): Promise<CreateTransportOrderResponse> {
    if (process.env['FLEET_PILOT_SEED_ENABLED'] === 'false') {
      throw new ForbiddenException('seed endpoint disabled');
    }
    const input = CreateTransportOrderSchema.parse(body);
    return this.svc.create(input, op);
  }

  @Get('assigned')
  async listAssigned(@CurrentOperator() op: OperatorContext): Promise<ListAssignedResponse> {
    return this.svc.listAssigned(op);
  }
}
