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
const DraftSchema = z.strictObject({
  summaryVi: z.string().min(1),
  commands: z
    .array(z.discriminatedUnion('type', [DraftCreateDriverSchema, DraftAssignSchema]))
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
  constructor(
    @Inject(COPILOT_CATALOG_PORT)
    private readonly catalog: CopilotCatalogPort,
    @Optional()
    @Inject(COPILOT_LLM_PORT)
    private readonly llm: CopilotLlmPort | null,
  ) {}

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

  private async resolveDraft(draft: Draft, op: OperatorContext): Promise<CopilotPlanResponse> {
    const drivers = await this.catalog.drivers(op);
    const vehicles = await this.catalog.vehiclesAdmin(op);
    const commands: CopilotCommand[] = [];
    const pendingDriverIds = new Map<string, string>();
    for (const cmd of draft.commands) {
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
