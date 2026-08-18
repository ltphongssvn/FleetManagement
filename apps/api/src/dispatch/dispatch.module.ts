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
import { DispatchRosterSplitController } from './dispatch-roster-split.controller.js';
import { DispatchRosterSplitService, ROSTER_SPLIT_NOW, type NowFn } from './dispatch-roster-split.service.js';
import { DriverAssignmentsController } from './driver-assignments.controller.js';
import { DriverDeliveryController } from './driver-delivery.controller.js';
import { DriverDeliveryService } from './driver-delivery.service.js';

// ROSTER_SPLIT_NOW binds the real wall clock for the dispatched-vs-idle panel.
// The Asia/Ho_Chi_Minh day window is derived from this instant, so the clock is
// injected (never read inline) and tests substitute a fixed Date - mirroring
// OWNER_METRICS_NOW in OwnerModule.
@Module({
  imports: [DatabaseModule, AuthModule, StopProofModule],
  controllers: [
    DispatchController,
    DispatchRosterSplitController,
    DriverAssignmentsController,
    DriverDeliveryController,
  ],
  providers: [
    DriverDeliveryService,
    DispatchRosterSplitService,
    { provide: ROSTER_SPLIT_NOW, useValue: (() => new Date()) satisfies NowFn },
  ],
  exports: [StopProofModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DispatchModule {}
