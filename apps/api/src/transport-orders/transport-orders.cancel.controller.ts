// apps/api/src/transport-orders/transport-orders.cancel.controller.ts
// T5 (2026): dispatcher cancels a transport order.
// REST shape: POST /transport-orders/:id/cancel  body: { reason, note? }
//
// Action-style URL (not DELETE) because cancel is a state transition, not
// a destructive removal. Industry consensus per 2026 best-practice surveys:
// DELETE implies the resource ceases to exist; cancellation preserves the
// row for audit and reporting.
//
// HTTP boundary translates domain errors:
//   TransportOrderNotFoundError         -> 404 NotFoundException
//   TransportOrderCannotBeCancelledError -> 409 ConflictException
// Everything else falls through unchanged for the framework's 500 handler.
import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { CancelOrderInputSchema, type CancelOrderResult } from './transport-orders.cancel.dto.js';
import { TransportOrdersCancelService } from './transport-orders.cancel.service.js';
import {
  TransportOrderCannotBeCancelledError,
  TransportOrderNotFoundError,
} from './transport-orders.errors.js';
const IdParamSchema = z.string().uuid();
@Controller('transport-orders')
@UseGuards(JwtGuard)
export class TransportOrdersCancelController {
  constructor(private readonly svc: TransportOrdersCancelService) {}
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<CancelOrderResult> {
    const parsedId = IdParamSchema.parse(id);
    const parsedBody = CancelOrderInputSchema.parse(body);
    try {
      return await this.svc.cancel(parsedId, parsedBody, op);
    } catch (err) {
      if (err instanceof TransportOrderNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof TransportOrderCannotBeCancelledError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}
