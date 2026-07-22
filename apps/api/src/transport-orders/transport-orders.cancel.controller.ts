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
//
// Synchronous projection drain (T5 follow-on, revealed by
// e2e/dispatch-board-reflects-cancel.spec.ts): after a successful cancel
// commits, the controller drains the dispatch_board projection for the
// caller's company before returning to the client. The scheduler's
// 5-second projection poll is too slow for an interactive cancel: the
// ops-web cancel-order.action.ts revalidates the board cache and
// redirects '/' immediately, so the SSR re-fetch must see the fresh
// projection row. Draining synchronously here removes the race and
// keeps the rest of the projection pipeline (outbox, audit log)
// unchanged.
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
import { UuidParamSchema } from '../common/uuid-param.schema.js';
import { JwtGuard } from '../auth/jwt.guard.js';
import { CurrentOperator } from '../auth/current-operator.decorator.js';
import type { OperatorContext } from '../auth/operator-context.js';
import { CancelOrderInputSchema, type CancelOrderResult } from './transport-orders.cancel.dto.js';
import { TransportOrdersCancelService } from './transport-orders.cancel.service.js';
import { ProjectionRunnerService } from '../projections/projection-runner.service.js';
import {
  TransportOrderCannotBeCancelledError,
  TransportOrderCannotBeCancelledWithReceivedPhotosError,
  TransportOrderNotFoundError,
} from './transport-orders.errors.js';
// Axis-2 SSOT (2026-07-07): shared UuidParamSchema replaces local z.guid()
// (guid accepted any hex layout; uuid enforces RFC version/variant).
const IdParamSchema = UuidParamSchema;
@Controller('transport-orders')
@UseGuards(JwtGuard)
export class TransportOrdersCancelController {
  constructor(
    private readonly svc: TransportOrdersCancelService,
    private readonly projectionRunner: ProjectionRunnerService,
  ) {}
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentOperator() op: OperatorContext,
  ): Promise<CancelOrderResult> {
    const parsedId = IdParamSchema.parse(id);
    const parsedBody = CancelOrderInputSchema.parse(body);
    let result: CancelOrderResult;
    try {
      result = await this.svc.cancel(parsedId, parsedBody, op);
    } catch (err) {
      if (err instanceof TransportOrderNotFoundError) {
        throw new NotFoundException(err.message);
      }
      if (err instanceof TransportOrderCannotBeCancelledWithReceivedPhotosError) {
        // Localized business message for the dispatcher: a weigh-slip photo
        // (phieu can) has already been received, so the order cannot be cancelled.
        throw new ConflictException(
          'Không thể hủy lệnh: đã nhận phiếu cân cho lệnh này. Lệnh đã bắt đầu vận chuyển.',
        );
      }
      if (err instanceof TransportOrderCannotBeCancelledError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
    await this.projectionRunner.drainOnce(op.companyId);
    return result;
  }
}
