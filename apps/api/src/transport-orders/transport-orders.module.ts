// apps/api/src/transport-orders/transport-orders.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { TransportOrdersController } from './transport-orders.controller.js';
import { TransportOrdersReviewController } from './transport-orders.review.controller.js';
import { TransportOrdersService } from './transport-orders.service.js';
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [TransportOrdersController, TransportOrdersReviewController],
  providers: [TransportOrdersService],
  exports: [TransportOrdersService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class TransportOrdersModule {}
