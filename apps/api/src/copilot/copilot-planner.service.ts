// apps/api/src/copilot/copilot-planner.service.ts
// Planner for the dispatcher Command Palette: free text -> CopilotPlanResponse.
// Layered strictly: (1) deterministic Vietnamese quick-grammar (zero LLM, zero
// latency) for the two highest-frequency verbs; (2) optional LLM port proposing
// an UNTRUSTED draft that is Zod-parsed (strict; unknown keys or shapes ->
// clarify) and then RESOLVED against the tenant catalog (normalized plate ->
// vehicleId; unique fullName -> driverId; a driver created earlier in the same
// draft -> stepOutput chain ref). Ambiguity or misses always -> clarify with
// candidates; the planner NEVER guesses ids and NEVER invents credentials
// (password is always null; the executor generates). Output is internally typed
// CopilotPlan (no self re-parse per the two-axis rule); the execute endpoint
// re-parses at its own boundary.
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { z } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import {
  normalizePlate,
  type CopilotCommand,
  type CopilotEntityRef,
  type CopilotPlan,
  type CopilotPlanResponse,
} from '@fleet/sync-protocol';
import { toAnthropicJsonSchema } from './anthropic-json-schema.js';

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
  proposeDraft: (text: string, jsonSchema: Record<string, unknown>) => Promise<unknown>;
}

// .describe() is not decoration: it is emitted into the generated JSON Schema
// and guides the model, which is why the adapter no longer hand-writes the
// draft shape in prose. One declaration drives THREE things -- the sampler
// grammar (structured outputs), the runtime validator, and the model-facing
// field documentation -- so they cannot drift apart.
const DraftCreateDriverSchema = z.strictObject({
  type: z.literal('create_driver'),
  fullName: z.string().min(1).max(200).describe('Ho ten day du cua tai xe'),
  phone: z.string().min(8).max(32).describe('So dien thoai, chi chu so'),
});
const DraftAssignSchema = z.strictObject({
  type: z.literal('assign_driver_to_vehicle'),
  driverName: z.string().min(1).max(200).describe('Ho ten tai xe can gan'),
  vehiclePlate: z.string().min(1).max(32).describe('Bien so xe dung nhu nguoi dung viet'),
});
// ESCAPE HATCH -- safety-relevant schema configuration, not a nicety.
// Constrained decoding compiles this schema into a grammar and mechanically
// forbids anything outside it. With only concrete action types available and
// commands required non-empty, the model had no grammatical way to report that
// a request made no sense, so for the input 'zzz khong hieu gi ca' it emitted a
// perfectly-formed FABRICATED driver (fullName Unknown, phone 0000000000).
// That is the escape-less-enum anti-pattern: schema compliance is a HARD
// constraint enforced at the decoder while abstention is only a soft
// preference, so the constraint wins every time they conflict. No prompt
// wording fixes it -- the grammar itself must offer a truthful option.
const DraftUnknownSchema = z.strictObject({
  type: z.literal('unknown'),
});
const DraftSchema = z.strictObject({
  summaryVi: z.string().min(1).describe('Tom tat ngan bang tieng Viet'),
  commands: z
    .array(
      z.discriminatedUnion('type', [
        DraftCreateDriverSchema,
        DraftAssignSchema,
        DraftUnknownSchema,
      ]),
    )
    .min(1)
    .describe('It nhat mot lenh; dung type unknown khi khong hieu yeu cau'),
});
type Draft = z.infer<typeof DraftSchema>;

// Derived ONCE at module load, then dialect-adapted. Two projections of ONE
// SSOT: the wire schema constrains the SAMPLER, DraftSchema validates the
// reply. z.toJSONSchema is native in Zod 4 (zod-to-json-schema is unmaintained
// since Nov 2025) and z.strictObject yields additionalProperties:false, which
// providers require for constrained decoding. The dialect step is not cosmetic:
// Anthropic rejected the raw Zod output with 400 Schema type oneOf is not
// supported, because z.discriminatedUnion serializes as oneOf.
const DRAFT_JSON_SCHEMA = toAnthropicJsonSchema(
  z.toJSONSchema(DraftSchema, { io: 'output' }) as Record<string, unknown>,
);

const CLARIFY_GENERIC = 'Tôi chưa hiểu yêu cầu. Bạn có thể mô tả cụ thể hơn không?';
/**
 * Distinct from CLARIFY_GENERIC on purpose. The two mean different things
 * operationally -- the model ABSTAINED (it understood it did not understand)
 * versus the draft was MALFORMED (a provider or contract problem) -- and
 * collapsing them would hide the difference from logs and from specs.
 */
export const CLARIFY_UNCLEAR =
  'Tôi chưa rõ yêu cầu này. Bạn có thể nói cụ thể hơn được không?';
const QUICK_CARGO_PREFIX = 'thêm tên hàng ';
const QUICK_CUSTOMER_PREFIX = 'thêm khách hàng ';

function clarify(questionVi: string): CopilotPlanResponse {
  return { kind: 'clarify', questionVi };
}

@Injectable()
export class CopilotPlannerService {
  private readonly logger = new Logger(CopilotPlannerService.name);
  private readonly llm: CopilotLlmPort | null;

  constructor(
    @Inject(COPILOT_CATALOG_PORT)
    private readonly catalog: CopilotCatalogPort,
    // Nest injects UNDEFINED (not null) when an @Optional token is absent
    // (house precedent: BCRYPT_HASH seam). Normalize here so every downstream
    // check is a single === null.
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
    // The LLM is an OPTIONAL enrichment path sitting beside a working
    // deterministic one, so an EXECUTION failure (provider 5xx/429, network,
    // malformed body) must degrade to clarify -- never propagate and 500 the
    // dispatcher. Logged rather than swallowed: an untested, untraced fallback
    // is the documented way such failures stay invisible until a user finds
    // them.
    let raw: unknown;
    try {
      raw = await this.llm.proposeDraft(text, DRAFT_JSON_SCHEMA);
    } catch (err) {
      this.logger.error('copilot LLM port failed; degrading to clarify', err);
      return clarify(CLARIFY_GENERIC);
    }
    const parsed = DraftSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn('copilot LLM draft failed DraftSchema; degrading to clarify');
      return clarify(CLARIFY_GENERIC);
    }
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
    // Abstention short-circuits BEFORE any catalog work. Checked across the
    // whole draft rather than per command: one unintelligible clause makes the
    // whole utterance ambiguous, and a half-executed plan is worse than none.
    if (draft.commands.some((c) => c.type === 'unknown')) {
      this.logger.log('copilot LLM abstained via the unknown escape; clarifying');
      return clarify(CLARIFY_UNCLEAR);
    }
    const drivers = await this.catalog.drivers(op);
    const vehicles = await this.catalog.vehiclesAdmin(op);
    const commands: CopilotCommand[] = [];
    const pendingDriverIds = new Map<string, string>();
    for (const cmd of draft.commands) {
      if (cmd.type === 'unknown') continue;
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
