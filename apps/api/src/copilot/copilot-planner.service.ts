// apps/api/src/copilot/copilot-planner.service.ts
// Planner for the dispatcher Command Palette: free text -> CopilotPlanResponse.
// Layered strictly: (1) deterministic Vietnamese quick-grammar (zero LLM,
// zero latency) for the two highest-frequency verbs; (2) optional LLM port
// proposing an UNTRUSTED draft that is Zod-parsed (strict; unknown keys or
// shapes -> clarify) and then RESOLVED against the tenant catalog
// (normalized plate -> vehicleId; unique fullName -> driverId; a driver
// created earlier in the same draft -> stepOutput chain ref). Ambiguity or
// misses always -> clarify with candidates; the planner NEVER guesses ids
// and NEVER invents credentials (password is always null; the executor
// generates). Output is internally typed CopilotPlan (no self re-parse per
// the two-axis rule); the execute endpoint re-parses at its own boundary.
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import {
  normalizePlate,
  type CopilotCommand,
  type CopilotEntityRef,
  type CopilotPlan,
  type CopilotPlanResponse,
} from '@fleet/sync-protocol';

export const COPILOT_CATALOG_PORT = 'COPILOT_CATALOG_PORT';
export const COPILOT_LLM_PORT = 'COPILOT_LLM_PORT';

export interface CopilotCatalogDriver {
  readonly driverId: string;
  readonly operatorId: string | null;
  readonly fullName: string;
  readonly phone: string | null;
}

/** Read-only tenant catalog the planner resolves names/plates against. */
export interface CopilotCatalogPort {
  customers: (op: OperatorContext) => Promise<readonly { id: string; label: string }[]>;
  cargoTypes: (op: OperatorContext) => Promise<readonly { id: string; label: string }[]>;
  warehouses: (
    op: OperatorContext,
    role: 'pickup' | 'delivery',
  ) => Promise<readonly { id: string; label: string }[]>;
  drivers: (op: OperatorContext) => Promise<readonly CopilotCatalogDriver[]>;
  vehiclesAdmin: (op: OperatorContext) => Promise<readonly { id: string; label: string }[]>;
}

/** The only LLM boundary: returns an UNTRUSTED draft (parsed by us). */
export interface CopilotLlmPort {
  proposeDraft: (text: string) => Promise<unknown>;
}

const DraftCreateDriverSchema = z.strictObject({
  type: z.literal('create_driver'),
  fullName: z.string().min(1).max(200),
  phone: z.string().min(8).max(32),
});
const DraftAssignSchema = z.strictObject({
  type: z.literal('assign_driver_to_vehicle'),
  driverName: z.string().min(1).max(200),
  vehiclePlate: z.string().min(1).max(32),
});
const DraftCreateTransportOrderSchema = z.strictObject({
  type: z.literal('create_transport_order'),
  driverName: z.string().min(1).max(200),
  vehiclePlate: z.string().min(1).max(32),
  customerName: z.string().min(1).max(200).nullable(),
  cargoName: z.string().min(1).max(200).nullable(),
  pickupWarehouseNames: z.array(z.string().min(1).max(200)).min(1).max(4),
  deliveryWarehouseNames: z.array(z.string().min(1).max(200)).min(1).max(4),
  plannedStartDate: z.iso.date(),
  pickupDate: z.iso.date(),
  deliveryDate: z.iso.date(),
});
const DraftSchema = z.strictObject({
  summaryVi: z.string().min(1),
  commands: z
    .array(z.discriminatedUnion('type', [DraftCreateDriverSchema, DraftAssignSchema, DraftCreateTransportOrderSchema]))
    .min(1),
});
type Draft = z.infer<typeof DraftSchema>;

const CLARIFY_GENERIC = 'Tôi chưa hiểu yêu cầu. Bạn có thể mô tả cụ thể hơn không?';
const QUICK_CARGO_PREFIX = 'thêm tên hàng ';
const QUICK_CUSTOMER_PREFIX = 'thêm khách hàng ';

function clarify(questionVi: string): CopilotPlanResponse {
  return { kind: 'clarify', questionVi };
}

@Injectable()
export class CopilotPlannerService {
  private readonly llm: CopilotLlmPort | null;

  constructor(
    @Inject(COPILOT_CATALOG_PORT)
    private readonly catalog: CopilotCatalogPort,
    // Nest injects UNDEFINED (not null) when an @Optional token is absent
    // (house precedent: BCRYPT_HASH seam). Normalize here so every
    // downstream check is a single === null.
    @Optional()
    @Inject(COPILOT_LLM_PORT)
    llm?: CopilotLlmPort,
  ) {
    this.llm = llm ?? null;
  }

  async plan(text: string, op: OperatorContext): Promise<CopilotPlanResponse> {
    const quick = this.tryQuickAction(text);
    if (quick !== null) return quick;
    if (this.llm === null) return clarify(CLARIFY_GENERIC);
    const raw = await this.llm.proposeDraft(text);
    const parsed = DraftSchema.safeParse(raw);
    if (!parsed.success) return clarify(CLARIFY_GENERIC);
    return this.resolveDraft(parsed.data, op);
  }

  private tryQuickAction(text: string): CopilotPlanResponse | null {
    const lower = text.trim().toLowerCase();
    if (lower.startsWith(QUICK_CARGO_PREFIX)) {
      const name = text.trim().slice(QUICK_CARGO_PREFIX.length).trim();
      return this.singleCommandPlan('Sẽ tạo tên hàng ' + name, {
        type: 'create_cargo_type',
        commandId: randomUUID(),
        name,
      });
    }
    if (lower.startsWith(QUICK_CUSTOMER_PREFIX)) {
      const name = text.trim().slice(QUICK_CUSTOMER_PREFIX.length).trim();
      return this.singleCommandPlan('Sẽ tạo khách hàng ' + name, {
        type: 'create_customer',
        commandId: randomUUID(),
        name,
        phone: null,
      });
    }
    return null;
  }

  private singleCommandPlan(summaryVi: string, command: CopilotCommand): CopilotPlanResponse {
    const plan: CopilotPlan = { planId: randomUUID(), summaryVi, commands: [command] };
    return { kind: 'plan', plan };
  }

  private async resolveTransportOrder(
    cmd: Draft['commands'][number] & { type: 'create_transport_order' },
    op: OperatorContext,
    drivers: readonly CopilotCatalogDriver[],
    vehicles: readonly { id: string; label: string }[],
  ): Promise<CopilotCommand | CopilotPlanResponse> {
    const plateKey = normalizePlate(cmd.vehiclePlate);
    const vehicle = vehicles.find((v) => normalizePlate(v.label) === plateKey);
    if (vehicle === undefined) {
      return clarify('Không tìm thấy xe ' + plateKey + '. Vui lòng kiểm tra biển số.');
    }
    const matches = drivers.filter((d) => d.fullName === cmd.driverName);
    if (matches.length !== 1) {
      return {
        kind: 'clarify',
        questionVi: 'Có ' + String(matches.length) + ' tài xế tên ' + cmd.driverName + '. Bạn muốn chọn ai?',
        candidates: matches.map((d) => ({ idSpace: 'driverId' as const, id: d.driverId, label: d.fullName })),
      };
    }
    const only = matches[0];
    if (only?.operatorId == null) {
      return clarify('Tài xế ' + cmd.driverName + ' chưa có tài khoản điều hành. Vui lòng kiểm tra lại.');
    }
    const resolveByLabel = (
      name: string,
      list: readonly { id: string; label: string }[],
      space: 'customerId' | 'cargoTypeId' | 'warehouseId',
      missingVi: string,
    ): { id: string } | CopilotPlanResponse => {
      const found = list.filter((x) => x.label === name);
      const head = found[0];
      if (found.length === 1 && head !== undefined) return { id: head.id };
      return {
        kind: 'clarify',
        questionVi: missingVi,
        candidates: list.map((x) => ({ idSpace: space, id: x.id, label: x.label })),
      };
    };
    const idRef = <S extends 'customerId' | 'cargoTypeId' | 'warehouseId'>(space: S, id: string): { kind: 'id'; idSpace: S; id: string } =>
      ({ kind: 'id' as const, idSpace: space, id });
    let customer: { kind: 'id'; idSpace: 'customerId'; id: string } | null = null;
    if (cmd.customerName !== null) {
      const r = resolveByLabel(cmd.customerName, await this.catalog.customers(op), 'customerId',
        'Không tìm thấy khách hàng ' + cmd.customerName + '. Bạn muốn chọn ai?');
      if ('kind' in r) return r;
      customer = { kind: 'id', idSpace: 'customerId', id: r.id };
    }
    let cargoType: { kind: 'id'; idSpace: 'cargoTypeId'; id: string } | null = null;
    if (cmd.cargoName !== null) {
      const r = resolveByLabel(cmd.cargoName, await this.catalog.cargoTypes(op), 'cargoTypeId',
        'Không tìm thấy tên hàng ' + cmd.cargoName + '. Bạn muốn chọn loại nào?');
      if ('kind' in r) return r;
      cargoType = { kind: 'id', idSpace: 'cargoTypeId', id: r.id };
    }
    const pickupList = await this.catalog.warehouses(op, 'pickup');
    const pickupRefs: { kind: 'id'; idSpace: 'warehouseId'; id: string }[] = [];
    for (const name of cmd.pickupWarehouseNames) {
      const r = resolveByLabel(name, pickupList, 'warehouseId',
        'Không tìm thấy kho nhận ' + name + '. Bạn muốn chọn kho nào?');
      if ('kind' in r) return r;
      pickupRefs.push(idRef('warehouseId', r.id));
    }
    const deliveryList = await this.catalog.warehouses(op, 'delivery');
    const deliveryRefs: { kind: 'id'; idSpace: 'warehouseId'; id: string }[] = [];
    for (const name of cmd.deliveryWarehouseNames) {
      const r = resolveByLabel(name, deliveryList, 'warehouseId',
        'Không tìm thấy kho giao ' + name + '. Bạn muốn chọn kho nào?');
      if ('kind' in r) return r;
      deliveryRefs.push(idRef('warehouseId', r.id));
    }
    return {
      type: 'create_transport_order',
      commandId: randomUUID(),
      operator: { kind: 'id', idSpace: 'operatorId', id: only.operatorId },
      vehicle: { kind: 'id', idSpace: 'vehicleId', id: vehicle.id },
      customer,
      cargoType,
      pickupWarehouses: pickupRefs,
      deliveryWarehouses: deliveryRefs,
      plannedStartDate: cmd.plannedStartDate,
      pickupDate: cmd.pickupDate,
      deliveryDate: cmd.deliveryDate,
    };
  }
  private async resolveDraft(draft: Draft, op: OperatorContext): Promise<CopilotPlanResponse> {
    const drivers = await this.catalog.drivers(op);
    const vehicles = await this.catalog.vehiclesAdmin(op);
    const commands: CopilotCommand[] = [];
    const pendingDriverIds = new Map<string, string>();
    for (const cmd of draft.commands) {
      if (cmd.type === 'create_transport_order') {
        const resolved = await this.resolveTransportOrder(cmd, op, drivers, vehicles);
        if ('kind' in resolved) return resolved;
        commands.push(resolved);
        continue;
      }
      if (cmd.type === 'create_driver') {
        const commandId = randomUUID();
        pendingDriverIds.set(cmd.fullName, commandId);
        commands.push({
          type: 'create_driver',
          commandId,
          fullName: cmd.fullName,
          phone: cmd.phone,
          password: null,
        });
        continue;
      }
      const plateKey = normalizePlate(cmd.vehiclePlate);
      const vehicle = vehicles.find((v) => normalizePlate(v.label) === plateKey);
      if (vehicle === undefined) {
        return clarify('Không tìm thấy xe ' + plateKey + '. Vui lòng kiểm tra biển số.');
      }
      const pending = pendingDriverIds.get(cmd.driverName);
      let driverRef: CopilotEntityRef & { readonly output?: 'driverId'; readonly idSpace?: 'driverId' };
      if (pending !== undefined) {
        driverRef = { kind: 'stepOutput', fromCommandId: pending, output: 'driverId' };
      } else {
        const matches = drivers.filter((d) => d.fullName === cmd.driverName);
        const only = matches.length === 1 ? matches[0] : undefined;
        if (only === undefined) {
          return {
            kind: 'clarify',
            questionVi:
              'Có ' + String(matches.length) + ' tài xế tên ' + cmd.driverName + '. Bạn muốn chọn ai?',
            candidates: matches.map((d) => ({
              idSpace: 'driverId' as const,
              id: d.driverId,
              label: d.fullName,
            })),
          };
        }
        driverRef = { kind: 'id', idSpace: 'driverId', id: only.driverId };
      }
      commands.push({
        type: 'assign_driver_to_vehicle',
        commandId: randomUUID(),
        driver: driverRef as never,
        vehicle: { kind: 'id', idSpace: 'vehicleId', id: vehicle.id },
      });
    }
    const plan: CopilotPlan = { planId: randomUUID(), summaryVi: draft.summaryVi, commands };
    return { kind: 'plan', plan };
  }
}
