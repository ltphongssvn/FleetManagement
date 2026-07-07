// packages/sync-protocol/test/copilot-contract.test.ts
// Contract tests (RED-first) for the Copilot command-palette wire contract.
// Design rules encoded here:
//  - Schema-first / Zod-first: exported types MUST be z.infer-derived from
//    their schemas; expectTypeOf pins below make hand-written type drift a
//    compile-time failure, and fixtures consume the types via satisfies.
//  - Two-axis: command payloads are STRICT (LLM output is untrusted input;
//    unknown keys must be rejected), outer wire envelopes are LOOSE
//    (forward-compatible: unknown envelope keys survive).
//  - Id spaces are named explicitly (driverId vs operatorId vs vehicleId):
//    the reference drivers list returns operatorId while the assignment
//    endpoint consumes driverId, so the contract makes feeding the wrong
//    space unrepresentable at parse time.
//  - Plate matching is normalization-based (uppercase alphanumeric only);
//    stored labels remain verbatim dispatcher input.
//  - Vietnamese strings are immutable contracts, asserted verbatim.
import { randomBytes } from 'node:crypto';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  COPILOT_COMMAND_TYPES,
  CopilotCommandSchema,
  CopilotEntityRefSchema,
  CopilotExecutionResultSchema,
  CopilotPlanResponseSchema,
  CopilotPlanSchema,
  normalizePlate,
  parseCopilotExecutionResult,
  parseCopilotPlan,
  parseCopilotPlanResponse,
  type CopilotCommand,
  type CopilotEntityRef,
  type CopilotExecutionResult,
  type CopilotPlan,
  type CopilotPlanResponse,
} from '../src/copilot-types.js';

const GUID_A = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const GUID_B = 'b4cc290f-9c0a-4999-aa23-bdf5f7654113';
const GUID_C = 'c5dd3a10-ad1b-4aaa-bb34-ce06f8765224';
const GENERATED_CRED = 'tmp-' + randomBytes(6).toString('hex');

describe('@fleet/sync-protocol copilot contract', () => {
  describe('type derivation (z.infer is the single source of truth)', () => {
    it('derives every exported type from its schema', () => {
      expectTypeOf<CopilotPlan>().toEqualTypeOf<z.infer<typeof CopilotPlanSchema>>();
      expectTypeOf<CopilotCommand>().toEqualTypeOf<z.infer<typeof CopilotCommandSchema>>();
      expectTypeOf<CopilotEntityRef>().toEqualTypeOf<z.infer<typeof CopilotEntityRefSchema>>();
      expectTypeOf<CopilotPlanResponse>().toEqualTypeOf<z.infer<typeof CopilotPlanResponseSchema>>();
      expectTypeOf<CopilotExecutionResult>().toEqualTypeOf<z.infer<typeof CopilotExecutionResultSchema>>();
    });
  });

  describe('normalizePlate', () => {
    it('strips separators and uppercases for matching', () => {
      expect(normalizePlate('62H 05194')).toBe('62H05194');
      expect(normalizePlate('62h-051.94')).toBe('62H05194');
      expect(normalizePlate('  51B12345 ')).toBe('51B12345');
    });
    it('reduces to empty when nothing alphanumeric remains', () => {
      expect(normalizePlate(' -. ')).toBe('');
    });
  });

  describe('CopilotEntityRefSchema', () => {
    it('accepts a resolved id ref with an explicit id space', () => {
      const idRef = {
        kind: 'id', idSpace: 'vehicleId', id: GUID_A,
      } satisfies CopilotEntityRef;
      expect(CopilotEntityRefSchema.safeParse(idRef).success).toBe(true);
    });
    it('accepts a step-output ref chaining a prior command', () => {
      const stepRef = {
        kind: 'stepOutput', fromCommandId: GUID_A, output: 'driverId',
      } satisfies CopilotEntityRef;
      expect(CopilotEntityRefSchema.safeParse(stepRef).success).toBe(true);
    });
    it('rejects an unknown id space and a non-guid id', () => {
      expect(CopilotEntityRefSchema.safeParse({
        kind: 'id', idSpace: 'id', id: GUID_A,
      }).success).toBe(false);
      expect(CopilotEntityRefSchema.safeParse({
        kind: 'id', idSpace: 'vehicleId', id: 'xe-62H',
      }).success).toBe(false);
    });
  });

  describe('CopilotCommandSchema (strict producer payloads)', () => {
    it('parses create_customer with nullable phone', () => {
      const r = CopilotCommandSchema.safeParse({
        type: 'create_customer', commandId: GUID_A,
        name: 'Cty TNHH Minh Chau', phone: null,
      });
      expect(r.success).toBe(true);
    });
    it('rejects unknown keys on any command (LLM hallucination guard)', () => {
      const r = CopilotCommandSchema.safeParse({
        type: 'create_customer', commandId: GUID_A,
        name: 'X', phone: null, tenantId: 'evil',
      });
      expect(r.success).toBe(false);
    });
    it('parses create_cargo_type', () => {
      const r = CopilotCommandSchema.safeParse({
        type: 'create_cargo_type', commandId: GUID_A, name: 'Gạo',
      });
      expect(r.success).toBe(true);
    });
    it('requires a non-empty plate on create_vehicle', () => {
      expect(CopilotCommandSchema.safeParse({
        type: 'create_vehicle', commandId: GUID_A, plate: '',
      }).success).toBe(false);
      expect(CopilotCommandSchema.safeParse({
        type: 'create_vehicle', commandId: GUID_A, plate: '62H 05194',
      }).success).toBe(true);
    });
    it('enforces the warehouse role enum', () => {
      expect(CopilotCommandSchema.safeParse({
        type: 'create_warehouse', commandId: GUID_A,
        name: 'Kho Long An', role: 'pickup',
      }).success).toBe(true);
      expect(CopilotCommandSchema.safeParse({
        type: 'create_warehouse', commandId: GUID_A,
        name: 'Kho Long An', role: 'both',
      }).success).toBe(false);
    });
    it('parses create_driver with password null (executor generates it)', () => {
      const cmd = {
        type: 'create_driver', commandId: GUID_A,
        fullName: 'Nguyễn Văn A', phone: '0900000123', password: null,
      } satisfies CopilotCommand;
      expect(CopilotCommandSchema.safeParse(cmd).success).toBe(true);
    });
    it('bounds create_driver phone like the admin endpoint (8..32)', () => {
      const r = CopilotCommandSchema.safeParse({
        type: 'create_driver', commandId: GUID_A,
        fullName: 'Nguyễn Văn A', phone: '090', password: null,
      });
      expect(r.success).toBe(false);
    });
    it('accepts assign_driver_to_vehicle with an id ref or a step output', () => {
      expect(CopilotCommandSchema.safeParse({
        type: 'assign_driver_to_vehicle', commandId: GUID_A,
        driver: { kind: 'id', idSpace: 'driverId', id: GUID_B },
        vehicle: { kind: 'id', idSpace: 'vehicleId', id: GUID_C },
      }).success).toBe(true);
      expect(CopilotCommandSchema.safeParse({
        type: 'assign_driver_to_vehicle', commandId: GUID_A,
        driver: { kind: 'stepOutput', fromCommandId: GUID_B, output: 'driverId' },
        vehicle: { kind: 'id', idSpace: 'vehicleId', id: GUID_C },
      }).success).toBe(true);
    });
    it('rejects an operatorId ref where a driverId is required', () => {
      const r = CopilotCommandSchema.safeParse({
        type: 'assign_driver_to_vehicle', commandId: GUID_A,
        driver: { kind: 'id', idSpace: 'operatorId', id: GUID_B },
        vehicle: { kind: 'id', idSpace: 'vehicleId', id: GUID_C },
      });
      expect(r.success).toBe(false);
    });
  });

  describe('CopilotPlanSchema', () => {
    const flagship = {
      planId: GUID_A,
      summaryVi: 'Sẽ tạo tài xế Nguyễn Văn A và gán vào xe 62H-05194',
      commands: [
        {
          type: 'create_driver', commandId: GUID_B,
          fullName: 'Nguyễn Văn A', phone: '0900000123', password: null,
        },
        {
          type: 'assign_driver_to_vehicle', commandId: GUID_C,
          driver: { kind: 'stepOutput', fromCommandId: GUID_B, output: 'driverId' },
          vehicle: { kind: 'id', idSpace: 'vehicleId', id: GUID_A },
        },
      ],
    } satisfies CopilotPlan;
    it('parses the flagship chained plan', () => {
      expect(CopilotPlanSchema.safeParse(flagship).success).toBe(true);
    });
    it('requires at least one command and a non-empty Vietnamese summary', () => {
      expect(CopilotPlanSchema.safeParse({
        planId: GUID_A, summaryVi: 'Tóm tắt', commands: [],
      }).success).toBe(false);
      expect(CopilotPlanSchema.safeParse({
        planId: GUID_A, summaryVi: '',
        commands: flagship.commands.slice(0, 1),
      }).success).toBe(false);
    });
    it('rejects duplicate commandIds inside one plan', () => {
      const dup = {
        planId: GUID_A, summaryVi: 'Trùng id',
        commands: [
          { type: 'create_cargo_type', commandId: GUID_B, name: 'Gạo' },
          { type: 'create_cargo_type', commandId: GUID_B, name: 'Xi măng' },
        ],
      };
      expect(CopilotPlanSchema.safeParse(dup).success).toBe(false);
    });
  });

  describe('CopilotPlanResponseSchema (loose wire envelope)', () => {
    it('parses a plan response and a clarify response', () => {
      const planResp = CopilotPlanResponseSchema.safeParse({
        kind: 'plan',
        plan: {
          planId: GUID_A, summaryVi: 'Sẽ tạo tên hàng Gạo',
          commands: [{ type: 'create_cargo_type', commandId: GUID_B, name: 'Gạo' }],
        },
      });
      expect(planResp.success).toBe(true);
      const clarify = CopilotPlanResponseSchema.safeParse({
        kind: 'clarify',
        questionVi: 'Có 2 tài xế tên Nguyễn Văn A. Bạn muốn chọn ai?',
        candidates: [
          { idSpace: 'driverId', id: GUID_A, label: 'Nguyễn Văn A — 0900000123' },
          { idSpace: 'driverId', id: GUID_B, label: 'Nguyễn Văn A — 0900000456' },
        ],
      });
      expect(clarify.success).toBe(true);
    });
    it('tolerates unknown envelope keys for forward compatibility', () => {
      const r = CopilotPlanResponseSchema.safeParse({
        kind: 'clarify', questionVi: 'Xe nào?', futureField: 1,
      });
      expect(r.success).toBe(true);
    });
  });

  describe('CopilotExecutionResultSchema', () => {
    it('parses outcomes with one-time password and a duplicate short-circuit', () => {
      const ok = CopilotExecutionResultSchema.safeParse({
        planId: GUID_A, status: 'completed',
        results: [{
          commandId: GUID_B, outcome: 'ok',
          createdId: GUID_C, idSpace: 'driverId',
          generatedPassword: GENERATED_CRED,
        }],
      });
      expect(ok.success).toBe(true);
      const dup = CopilotExecutionResultSchema.safeParse({
        planId: GUID_A, status: 'duplicate', results: [],
      });
      expect(dup.success).toBe(true);
    });
    it('parses a failed run with the remainder skipped', () => {
      const r = CopilotExecutionResultSchema.safeParse({
        planId: GUID_A, status: 'failed',
        results: [
          { commandId: GUID_B, outcome: 'failed', errorCode: 'VALIDATION_FAILED' },
          { commandId: GUID_C, outcome: 'skipped' },
        ],
      });
      expect(r.success).toBe(true);
    });
  });

  describe('safe parse helpers (null, never throw)', () => {
    it('return null on garbage', () => {
      expect(parseCopilotPlan('x')).toBeNull();
      expect(parseCopilotPlanResponse(42)).toBeNull();
      expect(parseCopilotExecutionResult({})).toBeNull();
    });
    it('return the parsed value on valid input', () => {
      const plan = {
        planId: GUID_A, summaryVi: 'OK',
        commands: [{ type: 'create_cargo_type', commandId: GUID_B, name: 'Muối' }],
      };
      expect(parseCopilotPlan(plan)?.planId).toBe(GUID_A);
      expect(
        parseCopilotPlanResponse({ kind: 'clarify', questionVi: 'Xe nào?' })?.kind,
      ).toBe('clarify');
      expect(
        parseCopilotExecutionResult({ planId: GUID_A, status: 'completed', results: [] })
          ?.status,
      ).toBe('completed');
    });
  });

  describe('LLM-facing self-description', () => {
    it('carries a schema description that doubles as the model spec', () => {
      expect(typeof CopilotPlanSchema.description).toBe('string');
    });
  });

  it('exposes the command-type union constant', () => {
    expect(COPILOT_COMMAND_TYPES).toContain('assign_driver_to_vehicle');
  });
});
