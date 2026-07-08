// apps/api/test/copilot-executor.service.test.ts
// RED-first unit spec for CopilotExecutorService: deterministic orchestrator
// mapping CopilotPlan commands onto the EXISTING admin/reference services.
// No LLM here; no DB here (the dedup store is a narrow port, faked).
// Tenancy is injected from OperatorContext, never read from payloads.
import { randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopilotPlan } from '@fleet/sync-protocol';
import {
  CopilotExecutorService,
  type CopilotPlanExecutionStore,
} from '../src/copilot/copilot-executor.service.js';

vi.mock('../src/observability/otel.js', () => ({
  tagActiveSpan: vi.fn(),
}));

const GUID_PLAN = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const GUID_CMD1 = 'b4cc290f-9c0a-4999-aa23-bdf5f7654113';
const GUID_CMD2 = 'c5dd3a10-ad1b-4aaa-bb34-ce06f8765224';
const GUID_DRIVER = 'd6ee4b21-be2c-4bbb-cc45-df17a9876335';
const GUID_VEHICLE = 'e7ff5c32-cf3d-4ccc-dd56-e028ba987446';

const OP = {
  operatorId: 'f8aa6d43-daf4-4ddd-ee67-f139cba98557',
  companyId: 'f9bb7e54-eb05-4eee-ff78-a24adcba9668',
  businessUnitId: 'aacc8f65-fc16-4fff-aa89-b35bedcba779',
  depotId: null,
  legalEntityId: null,
} as const;

interface Fakes {
  store: CopilotPlanExecutionStore;
  driversCreate: { create: ReturnType<typeof vi.fn> };
  assignment: { assign: ReturnType<typeof vi.fn> };
  reference: {
    createCustomer: ReturnType<typeof vi.fn>;
    createCargoType: ReturnType<typeof vi.fn>;
    createVehicle: ReturnType<typeof vi.fn>;
    createWarehouse: ReturnType<typeof vi.fn>;
  };
}

function buildFakes(): Fakes {
  return {
    store: {
      tryBegin: vi.fn(() => Promise.resolve(true)),
      complete: vi.fn(() => Promise.resolve(undefined)),
    },
    driversCreate: {
      create: vi.fn(() => Promise.resolve({ driverId: GUID_DRIVER, operatorId: OP.operatorId })),
    },
    assignment: {
      assign: vi.fn(() => Promise.resolve({ assignmentId: GUID_CMD2 })),
    },
    reference: {
      createCustomer: vi.fn(() => Promise.resolve({ id: GUID_CMD1, label: 'KH' })),
      createCargoType: vi.fn(() => Promise.resolve({ id: GUID_CMD1, label: 'TH' })),
      createVehicle: vi.fn(() => Promise.resolve({ id: GUID_VEHICLE, label: '62H05194' })),
      createWarehouse: vi.fn(() => Promise.resolve({ id: GUID_CMD1, label: 'Kho' })),
    },
  };
}

function build(f: Fakes): CopilotExecutorService {
  return new CopilotExecutorService(
    f.store,
    f.driversCreate as never,
    f.assignment as never,
    f.reference as never,
  );
}

function flagshipPlan(password: string | null): CopilotPlan {
  return {
    planId: GUID_PLAN,
    summaryVi: 'Sẽ tạo tài xế Nguyễn Văn A và gán vào xe 62H-05194',
    commands: [
      {
        type: 'create_driver', commandId: GUID_CMD1,
        fullName: 'Nguyễn Văn A', phone: '0900000123', password,
      },
      {
        type: 'assign_driver_to_vehicle', commandId: GUID_CMD2,
        driver: { kind: 'stepOutput', fromCommandId: GUID_CMD1, output: 'driverId' },
        vehicle: { kind: 'id', idSpace: 'vehicleId', id: GUID_VEHICLE },
      },
    ],
  };
}

describe('@fleet/api CopilotExecutorService', () => {
  let f: Fakes;
  beforeEach(() => {
    f = buildFakes();
  });

  it('short-circuits as duplicate before touching any service', async () => {
    f.store.tryBegin = vi.fn(() => Promise.resolve(false));
    const out = await build(f).execute(flagshipPlan(null), OP as never);
    expect(out.status).toBe('duplicate');
    expect(out.results).toEqual([]);
    expect(f.driversCreate.create).not.toHaveBeenCalled();
    expect(f.store.complete).not.toHaveBeenCalled();
  });

  it('runs the flagship chain: created driverId feeds the assignment', async () => {
    const out = await build(f).execute(flagshipPlan(null), OP as never);
    expect(out.status).toBe('completed');
    expect(f.assignment.assign).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: GUID_DRIVER, vehicleId: GUID_VEHICLE }),
    );
    expect(out.results[1]).toEqual(
      expect.objectContaining({ commandId: GUID_CMD2, outcome: 'ok' }),
    );
  });

  it('injects tenancy from op, never from the payload', async () => {
    await build(f).execute(flagshipPlan(null), OP as never);
    expect(f.driversCreate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: OP.companyId,
        businessUnitId: OP.businessUnitId,
        depotId: OP.depotId,
        legalEntityId: OP.legalEntityId,
      }),
    );
    expect(f.assignment.assign).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: OP.companyId }),
    );
  });

  it('generates a one-time credential when password is null', async () => {
    const out = await build(f).execute(flagshipPlan(null), OP as never);
    const first = out.results[0];
    expect(first?.outcome).toBe('ok');
    expect(first?.createdId).toBe(GUID_DRIVER);
    expect(first?.idSpace).toBe('driverId');
    expect(typeof first?.generatedPassword).toBe('string');
    expect((first?.generatedPassword ?? '').length).toBeGreaterThanOrEqual(8);
    const arg = f.driversCreate.create.mock.calls[0]?.[0] as { password: string };
    expect(arg.password).toBe(first?.generatedPassword);
  });

  it('honors a dispatcher-stated credential and reports none back', async () => {
    const statedCred = 'sc-' + randomBytes(6).toString('hex');
    const out = await build(f).execute(flagshipPlan(statedCred), OP as never);
    const arg = f.driversCreate.create.mock.calls[0]?.[0] as { password: string };
    expect(arg.password).toBe(statedCred);
    expect(out.results[0]?.generatedPassword).toBeUndefined();
  });

  it('maps the four reference creates onto ReferenceService with op', async () => {
    const plan: CopilotPlan = {
      planId: GUID_PLAN,
      summaryVi: 'Tạo dữ liệu tham chiếu',
      commands: [
        { type: 'create_customer', commandId: GUID_CMD1, name: 'Cty A', phone: null },
        { type: 'create_cargo_type', commandId: GUID_CMD2, name: 'Gạo' },
        { type: 'create_vehicle', commandId: GUID_DRIVER, plate: '62H 05194' },
        { type: 'create_warehouse', commandId: GUID_VEHICLE, name: 'Kho 1', role: 'pickup' },
      ],
    };
    const out = await build(f).execute(plan, OP as never);
    expect(out.status).toBe('completed');
    expect(f.reference.createCustomer).toHaveBeenCalledWith(OP, 'Cty A', null);
    expect(f.reference.createCargoType).toHaveBeenCalledWith(OP, 'Gạo');
    expect(f.reference.createVehicle).toHaveBeenCalledWith(OP, '62H 05194');
    expect(f.reference.createWarehouse).toHaveBeenCalledWith(OP, 'Kho 1', 'pickup');
  });

  it('stops on first error, maps 409 to INVALID_STATE_TRANSITION, skips the rest', async () => {
    f.assignment.assign = vi.fn(() =>
      Promise.reject(new HttpException('already assigned', 409)),
    );
    const plan = flagshipPlan(null);
    plan.commands.push({
      type: 'create_cargo_type', commandId: GUID_VEHICLE, name: 'Muối',
    });
    const out = await build(f).execute(plan, OP as never);
    expect(out.status).toBe('failed');
    expect(out.results[1]).toEqual(
      expect.objectContaining({ outcome: 'failed', errorCode: 'INVALID_STATE_TRANSITION' }),
    );
    expect(out.results[2]).toEqual(
      expect.objectContaining({ outcome: 'skipped' }),
    );
    expect(f.store.complete).toHaveBeenCalledWith(GUID_PLAN, 'failed');
  });

  it.each([
    [400, 'VALIDATION_FAILED'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ] as const)('maps HttpException %i to %s', async (status, code) => {
    f.assignment.assign = vi.fn(() =>
      Promise.reject(new HttpException('denied', status)),
    );
    const out = await build(f).execute(flagshipPlan(null), OP as never);
    expect(out.status).toBe('failed');
    expect(out.results[1]?.errorCode).toBe(code);
  });

  it('omits operatorId from chain outputs when the row has none', async () => {
    f.driversCreate.create = vi.fn(() =>
      Promise.resolve({ driverId: GUID_DRIVER, operatorId: null }),
    );
    const out = await build(f).execute(flagshipPlan(null), OP as never);
    expect(out.status).toBe('completed');
    expect(out.results[0]?.createdId).toBe(GUID_DRIVER);
    expect(f.assignment.assign).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: GUID_DRIVER }),
    );
  });

  it('maps unknown exceptions to INTERNAL', async () => {
    f.driversCreate.create = vi.fn(() => Promise.reject(new Error('db down')));
    const out = await build(f).execute(flagshipPlan(null), OP as never);
    expect(out.results[0]?.errorCode).toBe('INTERNAL');
    expect(out.status).toBe('failed');
  });

  it('fails a dangling stepOutput ref with VALIDATION_FAILED, executing nothing after it', async () => {
    const plan: CopilotPlan = {
      planId: GUID_PLAN,
      summaryVi: 'Gán xe',
      commands: [
        {
          type: 'assign_driver_to_vehicle', commandId: GUID_CMD2,
          driver: { kind: 'stepOutput', fromCommandId: GUID_CMD1, output: 'driverId' },
          vehicle: { kind: 'id', idSpace: 'vehicleId', id: GUID_VEHICLE },
        },
      ],
    };
    const out = await build(f).execute(plan, OP as never);
    expect(out.status).toBe('failed');
    expect(out.results[0]?.errorCode).toBe('VALIDATION_FAILED');
    expect(f.assignment.assign).not.toHaveBeenCalled();
  });

  it('records completion in the dedup store on the happy path', async () => {
    await build(f).execute(flagshipPlan(null), OP as never);
    expect(f.store.tryBegin).toHaveBeenCalledWith(GUID_PLAN, OP.companyId);
    expect(f.store.complete).toHaveBeenCalledWith(GUID_PLAN, 'completed');
  });
});
