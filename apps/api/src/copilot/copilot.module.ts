// apps/api/src/copilot/copilot.module.ts
// Wires the Copilot executor onto the EXISTING services via typed factory
// providers: each useFactory declares the PORT as its return type, so
// service-to-port conformance is enforced by tsc at this exact site --
// drift in any admin/reference signature becomes a typecheck failure here,
// never a runtime surprise.
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AdminDriversListService } from '../admin/admin-drivers-list.service.js';
import { AdminAssignmentService } from '../admin/admin-assignment.service.js';
import { AdminDriversCreateService } from '../admin/admin-drivers-create.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReferenceModule } from '../reference/reference.module.js';
import { ReferenceService } from '../reference/reference.service.js';
import { CopilotController } from './copilot.controller.js';
import {
  COPILOT_ASSIGNMENT_PORT,
  COPILOT_DRIVERS_CREATE_PORT,
  COPILOT_PLAN_EXECUTION_STORE,
  COPILOT_REFERENCE_PORT,
  CopilotExecutorService,
  type CopilotAssignmentPort,
  type CopilotDriversCreatePort,
  type CopilotPlanExecutionStore,
  type CopilotReferencePort,
} from './copilot-executor.service.js';
import { CopilotPlanExecutionStoreService } from './copilot-plan-execution.store.js';
import {
  COPILOT_CATALOG_PORT,
  CopilotPlannerService,
  type CopilotCatalogPort,
} from './copilot-planner.service.js';

@Module({
  imports: [AuthModule, AdminModule, ReferenceModule],
  controllers: [CopilotController],
  providers: [
    CopilotExecutorService,
    CopilotPlanExecutionStoreService,
    CopilotPlannerService,
    {
      provide: COPILOT_CATALOG_PORT,
      useFactory: (
        driversList: AdminDriversListService,
        reference: ReferenceService,
      ): CopilotCatalogPort => ({
        drivers: async (op) => {
          const rows = await driversList.list({ companyId: op.companyId });
          return rows.map((r) => ({
            driverId: r.driverId,
            operatorId: r.operatorId,
            fullName: r.fullName,
            phone: r.phone,
          }));
        },
        vehiclesAdmin: async (op) => {
          const res = await reference.vehiclesAdmin(op);
          return res.items.map((i) => ({ id: i.id, label: i.label }));
        },
      }),
      inject: [AdminDriversListService, ReferenceService],
    },
    {
      provide: COPILOT_PLAN_EXECUTION_STORE,
      useFactory: (svc: CopilotPlanExecutionStoreService): CopilotPlanExecutionStore => svc,
      inject: [CopilotPlanExecutionStoreService],
    },
    {
      provide: COPILOT_DRIVERS_CREATE_PORT,
      useFactory: (svc: AdminDriversCreateService): CopilotDriversCreatePort => svc,
      inject: [AdminDriversCreateService],
    },
    {
      provide: COPILOT_ASSIGNMENT_PORT,
      useFactory: (svc: AdminAssignmentService): CopilotAssignmentPort => svc,
      inject: [AdminAssignmentService],
    },
    {
      provide: COPILOT_REFERENCE_PORT,
      useFactory: (svc: ReferenceService): CopilotReferencePort => svc,
      inject: [ReferenceService],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class CopilotModule {}
