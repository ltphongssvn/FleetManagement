// packages/sync-protocol/src/copilot-types.ts
// Wire contract for the dispatcher Command Palette (Copilot).
// Two-axis rule: command payloads are STRICT producer contracts (the LLM is
// an untrusted producer; unknown keys are rejected), while response
// envelopes are LOOSE consumer contracts (unknown keys survive so older
// clients tolerate newer servers). Types are z.infer-derived only.
// Id spaces are explicit: the drivers reference list returns operatorId
// while the assignment endpoint consumes driverId, so refs name their space
// and cross-space confusion fails at parse time, not at runtime in the api.
// NOTE (audit S2): create_driver field bounds mirror apps/api admin
// CreateSchema verbatim; shared-primitive extraction is tracked for Phase 3.
import { z } from 'zod';

/** Uppercase alphanumeric canonical form used ONLY for matching plates.
 *  Stored labels keep the dispatcher's verbatim input. */
export function normalizePlate(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const COPILOT_COMMAND_TYPES = Object.freeze([
  'create_customer',
  'create_cargo_type',
  'create_vehicle',
  'create_warehouse',
  'create_driver',
  'assign_driver_to_vehicle',
] as const);
export type CopilotCommandType = (typeof COPILOT_COMMAND_TYPES)[number];

/** Every id space a copilot entity reference may point into. */
export const CopilotIdSpaceSchema = z
  .enum(['driverId', 'operatorId', 'vehicleId', 'customerId', 'cargoTypeId', 'warehouseId'])
  .describe('Named id space; never a bare id');
export type CopilotIdSpace = z.infer<typeof CopilotIdSpaceSchema>;

const guid = (): z.ZodGUID => z.guid();

/** Resolved reference: a concrete row id in a named id space. */
const IdRefSchema = z.strictObject({
  kind: z.literal('id'),
  idSpace: CopilotIdSpaceSchema,
  id: guid().describe('Row id inside idSpace'),
});

/** Chained reference: the output of an earlier command in the same plan. */
const StepOutputRefSchema = z.strictObject({
  kind: z.literal('stepOutput'),
  fromCommandId: guid().describe('commandId of the producing step'),
  output: CopilotIdSpaceSchema.describe('Which id space that step produced'),
});

export const CopilotEntityRefSchema = z
  .discriminatedUnion('kind', [IdRefSchema, StepOutputRefSchema])
  .describe('Entity reference: resolved id or output of a prior step');
export type CopilotEntityRef = z.infer<typeof CopilotEntityRefSchema>;

// Narrowed refs for assign_driver_to_vehicle: the api consumes driverId and
// vehicleId specifically; any other space must fail at parse time.
const DriverIdRefSchema = z.strictObject({
  kind: z.literal('id'),
  idSpace: z.literal('driverId'),
  id: guid(),
});
const DriverStepOutputRefSchema = z.strictObject({
  kind: z.literal('stepOutput'),
  fromCommandId: guid(),
  output: z.literal('driverId'),
});
const VehicleIdRefSchema = z.strictObject({
  kind: z.literal('id'),
  idSpace: z.literal('vehicleId'),
  id: guid(),
});
const VehicleStepOutputRefSchema = z.strictObject({
  kind: z.literal('stepOutput'),
  fromCommandId: guid(),
  output: z.literal('vehicleId'),
});

const CreateCustomerSchema = z
  .strictObject({
    type: z.literal('create_customer'),
    commandId: guid(),
    name: z.string().min(1).max(200).describe('Customer display name, verbatim'),
    phone: z.string().min(8).max(32).nullable().describe('Phone if stated, else null'),
  })
  .describe('Create a customer (Them khach hang)');

const CreateCargoTypeSchema = z
  .strictObject({
    type: z.literal('create_cargo_type'),
    commandId: guid(),
    name: z.string().min(1).max(200).describe('Cargo name (Ten hang), verbatim'),
  })
  .describe('Create a cargo type (Ten hang)');

const CreateVehicleSchema = z
  .strictObject({
    type: z.literal('create_vehicle'),
    commandId: guid(),
    plate: z
      .string()
      .min(1)
      .max(32)
      .refine((p) => normalizePlate(p).length > 0, {
        message: 'plate must contain alphanumeric characters',
      })
      .describe('Vehicle plate (So xe) as spoken; matching is normalized'),
  })
  .describe('Create a vehicle (So xe)');

const CreateWarehouseSchema = z
  .strictObject({
    type: z.literal('create_warehouse'),
    commandId: guid(),
    name: z.string().min(1).max(200).describe('Warehouse name, verbatim'),
    role: z.enum(['pickup', 'delivery']).describe('pickup or delivery'),
  })
  .describe('Create a warehouse');

const CreateDriverSchema = z
  .strictObject({
    type: z.literal('create_driver'),
    commandId: guid(),
    fullName: z.string().min(1).max(200).describe('Driver full name, verbatim'),
    phone: z.string().min(8).max(32).describe('Driver phone, 8..32 chars'),
    password: z
      .string()
      .min(6)
      .max(128)
      .nullable()
      .describe('null unless the dispatcher stated one; executor generates'),
  })
  .describe('Create a driver account');

const AssignDriverToVehicleSchema = z
  .strictObject({
    type: z.literal('assign_driver_to_vehicle'),
    commandId: guid(),
    driver: z
      .discriminatedUnion('kind', [DriverIdRefSchema, DriverStepOutputRefSchema])
      .describe('Driver reference in the driverId space only'),
    vehicle: z
      .discriminatedUnion('kind', [VehicleIdRefSchema, VehicleStepOutputRefSchema])
      .describe('Vehicle reference in the vehicleId space only'),
  })
  .describe('Assign a driver to a vehicle (Chua giao -> assigned)');

export const CopilotCommandSchema = z
  .discriminatedUnion('type', [
    CreateCustomerSchema,
    CreateCargoTypeSchema,
    CreateVehicleSchema,
    CreateWarehouseSchema,
    CreateDriverSchema,
    AssignDriverToVehicleSchema,
  ])
  .describe('One executable dispatcher command');
export type CopilotCommand = z.infer<typeof CopilotCommandSchema>;

export const CopilotPlanSchema = z
  .strictObject({
    planId: guid().describe('Idempotency key for the whole plan'),
    summaryVi: z.string().min(1).describe('Vietnamese summary shown for confirmation'),
    commands: z.array(CopilotCommandSchema).min(1).describe('Ordered commands'),
  })
  .refine(
    (plan) => new Set(plan.commands.map((c) => c.commandId)).size === plan.commands.length,
    { message: 'commandId values must be unique within a plan', path: ['commands'] },
  )
  .describe(
    'Copilot plan: ordered dispatcher commands plus a Vietnamese summary; ' +
      'executed only after explicit human confirmation',
  );
export type CopilotPlan = z.infer<typeof CopilotPlanSchema>;

/** Clarify candidate offered when resolution is ambiguous. Wire: loose. */
const CopilotCandidateSchema = z.looseObject({
  idSpace: CopilotIdSpaceSchema,
  id: guid(),
  label: z.string().min(1),
});

const PlanOkResponseSchema = z.looseObject({
  kind: z.literal('plan'),
  plan: CopilotPlanSchema,
});
const PlanClarifyResponseSchema = z.looseObject({
  kind: z.literal('clarify'),
  questionVi: z.string().min(1),
  candidates: z.array(CopilotCandidateSchema).optional(),
});

export const CopilotPlanResponseSchema = z
  .discriminatedUnion('kind', [PlanOkResponseSchema, PlanClarifyResponseSchema])
  .describe('Planner response: an executable plan or a clarify question');
export type CopilotPlanResponse = z.infer<typeof CopilotPlanResponseSchema>;

const CopilotCommandResultSchema = z.looseObject({
  commandId: guid(),
  outcome: z.enum(['ok', 'failed', 'skipped']),
  createdId: guid().optional(),
  idSpace: CopilotIdSpaceSchema.optional(),
  generatedPassword: z.string().optional(),
  errorCode: z.string().optional(),
});

export const CopilotExecutionResultSchema = z
  .looseObject({
    planId: guid(),
    status: z.enum(['completed', 'failed', 'duplicate']),
    results: z.array(CopilotCommandResultSchema),
  })
  .describe('Execution outcome per command; duplicate = plan already ran');
export type CopilotExecutionResult = z.infer<typeof CopilotExecutionResultSchema>;

export function parseCopilotPlan(input: unknown): CopilotPlan | null {
  const r = CopilotPlanSchema.safeParse(input);
  return r.success ? r.data : null;
}
export function parseCopilotPlanResponse(input: unknown): CopilotPlanResponse | null {
  const r = CopilotPlanResponseSchema.safeParse(input);
  return r.success ? r.data : null;
}
export function parseCopilotExecutionResult(input: unknown): CopilotExecutionResult | null {
  const r = CopilotExecutionResultSchema.safeParse(input);
  return r.success ? r.data : null;
}
