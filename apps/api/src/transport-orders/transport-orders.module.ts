// apps/api/src/transport-orders/transport-orders.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { ProjectionsModule } from '../projections/projections.module.js';
// Phieu Can proof signing for the dispatcher REVIEW row. Provider-only module,
// so importing it pulls in the signer WITHOUT DispatchModule's controllers, and
// the board + review surfaces share ONE configured signer rather than two.
// Without this import the review read silently degrades to proof = null in
// production even though every test injecting a fake signer passes.
import { StopProofModule } from '../dispatch/stop-proof.module.js';
import { TransportOrdersController } from './transport-orders.controller.js';
import { TransportOrdersReviewController } from './transport-orders.review.controller.js';
import { TransportOrdersCancelController } from './transport-orders.cancel.controller.js';
import { TransportOrdersExportController } from './transport-orders-export.controller.js';
import { TransportOrdersService } from './transport-orders.service.js';
import { TransportOrdersCancelService } from './transport-orders.cancel.service.js';
import { TransportOrdersExportService } from './transport-orders-export.service.js';
import { OrderNumberingService } from './order-numbering.service.js';
@Module({
  imports: [AuthModule, DatabaseModule, ProjectionsModule, StopProofModule],
  controllers: [
    TransportOrdersController,
    TransportOrdersReviewController,
    TransportOrdersCancelController,
    TransportOrdersExportController,
  ],
  providers: [
    TransportOrdersService,
    TransportOrdersCancelService,
    TransportOrdersExportService,
    OrderNumberingService,
  ],
  exports: [
    TransportOrdersService,
    TransportOrdersCancelService,
    TransportOrdersExportService,
    OrderNumberingService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class TransportOrdersModule {}
