// apps/api/src/copilot/copilot-executor.service.ts
// Deterministic executor for confirmed Copilot plans. Zero LLM here: the
// planner proposes, the dispatcher confirms, THIS service performs -- by
// delegating every mutation to the EXISTING admin/reference services via
// narrow ports. Tenancy is injected from OperatorContext, never read from
// the payload. planId is the idempotency key (dedup store port); execution
// is stop-on-first-error with the remainder reported as skipped.
import { randomBytes } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { OperatorContext } from '@fleet/domain';
import type {
  CopilotCommand,
  CopilotEntityRef,
  CopilotExecutionResult,
  CopilotIdSpace,
  CopilotPlan,
  FleetErrorCode,
} from '@fleet/sync-protocol';
import type {
  CreateTransportOrderInput,
  CreateTransportOrderResponse,
} from '../transport-orders/transport-orders.dto.js';
import { tagActiveSpan } from '../observability/otel.js';

export const COPILOT_PLAN_EXECUTION_STORE = 'COPILOT_PLAN_EXECUTION_STORE';
export const COPILOT_DRIVERS_CREATE_PORT = 'COPILOT_DRIVERS_CREATE_PORT';
export const COPILOT_ASSIGNMENT_PORT = 'COPILOT_ASSIGNMENT_PORT';
export const COPILOT_REFERENCE_PORT = 'COPILOT_REFERENCE_PORT';
export const COPILOT_TRANSPORT_ORDER_PORT = 'COPILOT_TRANSPORT_ORDER_PORT';

type Tenancy = Pick<OperatorContext, 'companyId' | 'businessUnitId' | 'depotId' | 'legalEntityId'>;

/** Idempotency store: tryBegin returns false when planId was already run. */
export interface CopilotPlanExecutionStore {
  tryBegin: (planId: string, companyId: string) => Promise<boolean>;
  complete: (planId: string, status: 'completed' | 'failed') => Promise<void>;
}

/** Narrow surface of AdminDriversCreateService the executor uses. */
export interface CopilotDriversCreatePort {
  create: (
    input: { fullName: string; phone: string; password: string } & Tenancy,
  ) => Promise<{ driverId: string; operatorId: string | null }>;
}

/** Narrow surface of AdminAssignmentService the executor uses. */
export interface CopilotAssignmentPort {
  assign: (
    input: { driverId: string; vehicleId: string } & Tenancy,
  ) => Promise<{ assignmentId: string }>;
}

/** Narrow surface of ReferenceService the executor uses. */
export interface CopilotReferencePort {
  createCustomer: (
    op: OperatorContext,
    name: string,
    phone: string | null,
  ) => Promise<{ id: string; label: string }>;
  createCargoType: (op: OperatorContext, name: string) => Promise<{ id: string; label: string }>;
  createVehicle: (op: OperatorContext, plate: string) => Promise<{ id: string; label: string }>;
  createWarehouse: (
    op: OperatorContext,
    name: string,
    role: 'pickup' | 'delivery',
  ) => Promise<{ id: string; label: string }>;
}

/** Narrow surface of TransportOrdersService the executor uses. The full
 *  create pipeline (pair guard, So Lenh numbering, tri-write, driver alert)
 *  stays in that service; the executor only resolves refs and promotes the
 *  T8 date-only fields to UTC-midnight datetimes like create-order.action. */
export interface CopilotTransportOrderPort {
  create: (
    input: CreateTransportOrderInput,
    op: OperatorContext,
  ) => Promise<CreateTransportOrderResponse>;
}
type CommandOutcome = CopilotExecutionResult['results'][number];
type StepOutputs = Map<string, Partial<Record<CopilotIdSpace, string>>>;

function errorCodeFromException(e: unknown): FleetErrorCode {
  if (e instanceof HttpException) {
    const status = e.getStatus();
    if (status === 400) return 'VALIDATION_FAILED';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'INVALID_STATE_TRANSITION';
  }
  return 'INTERNAL';
}

@Injectable()
export class CopilotExecutorService {
  constructor(
    @Inject(COPILOT_PLAN_EXECUTION_STORE)
    private readonly store: CopilotPlanExecutionStore,
    @Inject(COPILOT_DRIVERS_CREATE_PORT)
    private readonly driversCreate: CopilotDriversCreatePort,
    @Inject(COPILOT_ASSIGNMENT_PORT)
    private readonly assignment: CopilotAssignmentPort,
    @Inject(COPILOT_REFERENCE_PORT)
    private readonly reference: CopilotReferencePort,
    @Inject(COPILOT_TRANSPORT_ORDER_PORT)
    private readonly transportOrder: CopilotTransportOrderPort,
  ) {}

  async execute(plan: CopilotPlan, op: OperatorContext): Promise<CopilotExecutionResult> {
    const fresh = await this.store.tryBegin(plan.planId, op.companyId);
    if (!fresh) {
      tagActiveSpan({ 'copilot.plan_id': plan.planId, 'copilot.outcome': 'duplicate' });
      return { planId: plan.planId, status: 'duplicate', results: [] };
    }
    const results: CommandOutcome[] = [];
    const outputs: StepOutputs = new Map();
    let failed = false;
    for (const cmd of plan.commands) {
      if (failed) {
        results.push({ commandId: cmd.commandId, outcome: 'skipped' });
        continue;
      }
      let outcome: CommandOutcome;
      try {
        outcome = await this.runCommand(cmd, op, outputs);
      } catch (e) {
        outcome = {
          commandId: cmd.commandId,
          outcome: 'failed',
          errorCode: errorCodeFromException(e),
        };
      }
      results.push(outcome);
      if (outcome.outcome === 'failed') failed = true;
      tagActiveSpan({
        'copilot.plan_id': plan.planId,
        'copilot.command_type': cmd.type,
        'copilot.command_outcome': outcome.outcome,
      });
    }
    const status = failed ? 'failed' : 'completed';
    await this.store.complete(plan.planId, status);
    tagActiveSpan({ 'copilot.plan_id': plan.planId, 'copilot.outcome': status });
    return { planId: plan.planId, status, results };
  }

  private async runCommand(
    cmd: CopilotCommand,
    op: OperatorContext,
    outputs: StepOutputs,
  ): Promise<CommandOutcome> {
    const tenancy: Tenancy = {
      companyId: op.companyId,
      businessUnitId: op.businessUnitId,
      depotId: op.depotId,
      legalEntityId: op.legalEntityId,
    };
    switch (cmd.type) {
      case 'create_driver': {
        let generated: string | null = null;
        let credential: string;
        if (cmd.password === null) {
          generated = 'tmp-' + randomBytes(9).toString('hex');
          credential = generated;
        } else {
          credential = cmd.password;
        }
        const row = await this.driversCreate.create({
          fullName: cmd.fullName,
          phone: cmd.phone,
          password: credential,
          ...tenancy,
        });
        const record: Partial<Record<CopilotIdSpace, string>> = {
          driverId: row.driverId,
        };
        if (row.operatorId !== null) record.operatorId = row.operatorId;
        outputs.set(cmd.commandId, record);
        return {
          commandId: cmd.commandId,
          outcome: 'ok',
          createdId: row.driverId,
          idSpace: 'driverId',
          ...(generated !== null ? { generatedPassword: generated } : {}),
        };
      }
      case 'create_customer': {
        const res = await this.reference.createCustomer(op, cmd.name, cmd.phone);
        outputs.set(cmd.commandId, { customerId: res.id });
        return { commandId: cmd.commandId, outcome: 'ok', createdId: res.id, idSpace: 'customerId' };
      }
      case 'create_cargo_type': {
        const res = await this.reference.createCargoType(op, cmd.name);
        outputs.set(cmd.commandId, { cargoTypeId: res.id });
        return { commandId: cmd.commandId, outcome: 'ok', createdId: res.id, idSpace: 'cargoTypeId' };
      }
      case 'create_vehicle': {
        const res = await this.reference.createVehicle(op, cmd.plate);
        outputs.set(cmd.commandId, { vehicleId: res.id });
        return { commandId: cmd.commandId, outcome: 'ok', createdId: res.id, idSpace: 'vehicleId' };
      }
      case 'create_warehouse': {
        const res = await this.reference.createWarehouse(op, cmd.name, cmd.role);
        outputs.set(cmd.commandId, { warehouseId: res.id });
        return { commandId: cmd.commandId, outcome: 'ok', createdId: res.id, idSpace: 'warehouseId' };
      }
      case 'assign_driver_to_vehicle': {
        const driverId = this.resolveId(cmd.driver, outputs);
        const vehicleId = this.resolveId(cmd.vehicle, outputs);
        if (driverId === null || vehicleId === null) {
          return {
            commandId: cmd.commandId,
            outcome: 'failed',
            errorCode: 'VALIDATION_FAILED',
          };
        }
        await this.assignment.assign({ driverId, vehicleId, ...tenancy });
        return { commandId: cmd.commandId, outcome: 'ok' };
      }
      case 'create_transport_order': {
        const fail: CommandOutcome = {
          commandId: cmd.commandId,
          outcome: 'failed',
          errorCode: 'VALIDATION_FAILED',
        };
        const operatorId = this.resolveId(cmd.operator, outputs);
        const vehicleId = this.resolveId(cmd.vehicle, outputs);
        if (operatorId === null || vehicleId === null) return fail;
        const customerId = cmd.customer === null ? undefined : this.resolveId(cmd.customer, outputs);
        const cargoTypeId = cmd.cargoType === null ? undefined : this.resolveId(cmd.cargoType, outputs);
        if (customerId === null || cargoTypeId === null) return fail;
        const pickupIds: string[] = [];
        for (const w of cmd.pickupWarehouses) {
          const id = this.resolveId(w, outputs);
          if (id === null) return fail;
          pickupIds.push(id);
        }
        const deliveryIds: string[] = [];
        for (const w of cmd.deliveryWarehouses) {
          const id = this.resolveId(w, outputs);
          if (id === null) return fail;
          deliveryIds.push(id);
        }
        const midnight = (d: string): string => d + 'T00:00:00.000Z';
        const stops: CreateTransportOrderInput['stops'] = [
          ...pickupIds.map((yardId, i) => ({
            sequence: i + 1,
            stopType: 'pickup',
            yardId,
            plannedAt: midnight(cmd.pickupDate),
          })),
          ...deliveryIds.map((yardId, i) => ({
            sequence: pickupIds.length + i + 1,
            stopType: 'delivery',
            yardId,
            plannedAt: midnight(cmd.deliveryDate),
          })),
        ];
        const res = await this.transportOrder.create(
          {
            stops,
            roadRun: {
              plannedStartAt: midnight(cmd.plannedStartDate),
              assignedOperatorId: operatorId,
              assignedAssetId: vehicleId,
            },
            ...(customerId !== undefined ? { customerId } : {}),
            ...(cargoTypeId !== undefined ? { cargoTypeId } : {}),
          },
          op,
        );
        return { commandId: cmd.commandId, outcome: 'ok', createdId: res.transportOrderId };
      }
    }
  }

  private resolveId(ref: CopilotEntityRef, outputs: StepOutputs): string | null {
    if (ref.kind === 'id') return ref.id;
    return outputs.get(ref.fromCommandId)?.[ref.output] ?? null;
  }
}
