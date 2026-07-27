// apps/api/src/dispatch/dispatch.module.ts
// Dispatch feature module: the board read + driver-facing assignment/delivery
// endpoints.
//
// The StopProofUrlSigner binding NO LONGER lives here. It moved to the
// provider-only StopProofModule so the dispatcher REVIEW read
// (TransportOrdersService) can share the SAME signer without importing this
// controller-bearing module, and without redefining the provider -- two
// independently-configured signers would hand the board and the review view
// links built from different endpoint/public-URL overrides. Imported and
// re-exported here so existing consumers of DispatchModule are unaffected.
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StopProofModule } from './stop-proof.module.js';
import { DispatchController } from './dispatch.controller.js';
import { DriverAssignmentsController } from './driver-assignments.controller.js';
import { DriverDeliveryController } from './driver-delivery.controller.js';
import { DriverDeliveryService } from './driver-delivery.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, StopProofModule],
  controllers: [DispatchController, DriverAssignmentsController, DriverDeliveryController],
  providers: [DriverDeliveryService],
  exports: [StopProofModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DispatchModule {}
