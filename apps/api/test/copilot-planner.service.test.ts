// apps/api/test/copilot-planner.service.test.ts
// RED-first spec for CopilotPlannerService: text -> CopilotPlanResponse.
// Deterministic quick-grammar first (zero LLM); otherwise the LLM port
// proposes an UNTRUSTED draft that is Zod-parsed and RESOLVED against the
// catalog (plate/name -> ids). Ambiguity or misses -> clarify, never guess.
import { describe, expect, it, vi } from 'vitest';
import type { OperatorContext } from '@fleet/domain';
import {
  CopilotPlannerService,
  type CopilotCatalogPort,
  type CopilotLlmPort,
} from '../src/copilot/copilot-planner.service.js';

const OP: OperatorContext = {
  operatorId: 'f8aa6d43-daf4-4ddd-8e67-f139cba98557',
  companyId: 'f9bb7e54-eb05-4eee-8f78-a24adcba9668',
  businessUnitId: 'aacc8f65-fc16-4aff-8a89-b35bedcba779',
  depotId: 'bbdd9a76-ad27-4b00-9b9a-c46cfedcb88a',
  legalEntityId: 'ccee0b87-be38-4c11-8cab-d57dafedc99b',
};
const D1 = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const D2 = 'b4cc290f-9c0a-4999-aa23-bdf5f7654113';
const V1 = 'c5dd3a10-ad1b-4aaa-bb34-ce06f8765224';

function catalog(): CopilotCatalogPort {
  return {
    drivers: vi.fn(() =>
      Promise.resolve([
        { driverId: D1, operatorId: OP.operatorId, fullName: 'Nguyễn Văn A', phone: '0900000123' },
      ]),
    ),
    vehiclesAdmin: vi.fn(() => Promise.resolve([{ id: V1, label: '62H05194' }])),
  };
}

function llmReturning(payload: unknown): CopilotLlmPort {
  return { proposeDraft: vi.fn(() => Promise.resolve(payload)) };
}

describe('@fleet/api CopilotPlannerService', () => {
  it('handles the quick action without touching the LLM (Thêm tên hàng)', async () => {
    const llm = llmReturning({});
    const svc = new CopilotPlannerService(catalog(), llm);
    const out = await svc.plan('Thêm tên hàng Gạo', OP);
    expect(out.kind).toBe('plan');
    if (out.kind === 'plan') {
      expect(out.plan.commands[0]).toEqual(
        expect.objectContaining({ type: 'create_cargo_type', name: 'Gạo' }),
      );
      expect(out.plan.summaryVi.length).toBeGreaterThan(0);
    }
    expect(llm.proposeDraft).not.toHaveBeenCalled();
  });

  it('handles Thêm khách hàng as a quick action', async () => {
    const svc = new CopilotPlannerService(catalog(), llmReturning({}));
    const out = await svc.plan('Thêm khách hàng Cty Minh Châu', OP);
    expect(out.kind).toBe('plan');
    if (out.kind === 'plan') {
      expect(out.plan.commands[0]).toEqual(
        expect.objectContaining({ type: 'create_customer', name: 'Cty Minh Châu', phone: null }),
      );
    }
  });

  it('resolves the flagship LLM draft: plate -> vehicleId, chained driver ref', async () => {
    const draft = {
      summaryVi: 'Sẽ tạo tài xế Nguyễn Văn B và gán vào xe 62H-05194',
      commands: [
        { type: 'create_driver', fullName: 'Nguyễn Văn B', phone: '0900000456' },
        { type: 'assign_driver_to_vehicle', driverName: 'Nguyễn Văn B', vehiclePlate: '62H 05194' },
      ],
    };
    const svc = new CopilotPlannerService(catalog(), llmReturning(draft));
    const out = await svc.plan('Thêm tài xế Nguyễn Văn B 0900000456 và gán vào xe 62H 05194', OP);
    expect(out.kind).toBe('plan');
    if (out.kind === 'plan') {
      const [create, assign] = out.plan.commands;
      expect(create).toEqual(
        expect.objectContaining({ type: 'create_driver', fullName: 'Nguyễn Văn B', password: null }),
      );
      if (assign?.type === 'assign_driver_to_vehicle' && create) {
        expect(assign.vehicle).toEqual({ kind: 'id', idSpace: 'vehicleId', id: V1 });
        expect(assign.driver).toEqual({
          kind: 'stepOutput',
          fromCommandId: create.commandId,
          output: 'driverId',
        });
      } else {
        throw new Error('expected assign command');
      }
    }
  });

  it('resolves an existing driver by unique name to an id ref', async () => {
    const draft = {
      summaryVi: 'Gán tài xế vào xe',
      commands: [
        { type: 'assign_driver_to_vehicle', driverName: 'Nguyễn Văn A', vehiclePlate: '62H05194' },
      ],
    };
    const svc = new CopilotPlannerService(catalog(), llmReturning(draft));
    const out = await svc.plan('Gán Nguyễn Văn A vào xe 62H 05194', OP);
    expect(out.kind).toBe('plan');
    if (out.kind === 'plan') {
      const [assign] = out.plan.commands;
      if (assign?.type === 'assign_driver_to_vehicle') {
        expect(assign.driver).toEqual({ kind: 'id', idSpace: 'driverId', id: D1 });
      } else {
        throw new Error('expected assign command');
      }
    }
  });

  it('clarifies on ambiguous driver names with candidates', async () => {
    const cat: CopilotCatalogPort = {
      drivers: vi.fn(() =>
        Promise.resolve([
          { driverId: D1, operatorId: null, fullName: 'Nguyễn Văn A', phone: '0900000123' },
          { driverId: D2, operatorId: null, fullName: 'Nguyễn Văn A', phone: '0900000456' },
        ]),
      ),
      vehiclesAdmin: vi.fn(() => Promise.resolve([{ id: V1, label: '62H05194' }])),
    };
    const draft = {
      summaryVi: 'Gán tài xế',
      commands: [
        { type: 'assign_driver_to_vehicle', driverName: 'Nguyễn Văn A', vehiclePlate: '62H05194' },
      ],
    };
    const svc = new CopilotPlannerService(cat, llmReturning(draft));
    const out = await svc.plan('Gán Nguyễn Văn A vào xe 62H 05194', OP);
    expect(out.kind).toBe('clarify');
    if (out.kind === 'clarify') {
      expect(out.candidates).toHaveLength(2);
      expect(out.candidates?.[0]).toEqual(
        expect.objectContaining({ idSpace: 'driverId', id: D1 }),
      );
    }
  });

  it('clarifies on an unknown plate instead of guessing', async () => {
    const draft = {
      summaryVi: 'Gán tài xế',
      commands: [
        { type: 'assign_driver_to_vehicle', driverName: 'Nguyễn Văn A', vehiclePlate: '99Z99999' },
      ],
    };
    const svc = new CopilotPlannerService(catalog(), llmReturning(draft));
    const out = await svc.plan('Gán Nguyễn Văn A vào xe 99Z 99999', OP);
    expect(out.kind).toBe('clarify');
    if (out.kind === 'clarify') expect(out.questionVi).toContain('99Z99999');
  });

  it('clarifies when the LLM returns garbage (never throws, never guesses)', async () => {
    const svc = new CopilotPlannerService(catalog(), llmReturning('not json at all'));
    const out = await svc.plan('làm gì đó phức tạp', OP);
    expect(out.kind).toBe('clarify');
  });

  it('clarifies when Nest injects undefined for the absent LLM port (prod shape)', async () => {
    const svc = new CopilotPlannerService(catalog(), undefined);
    const out = await svc.plan('điều phối lại toàn bộ đội xe', OP);
    expect(out.kind).toBe('clarify');
  });

  it('clarifies when no LLM port is configured and no quick action matches', async () => {
    const svc = new CopilotPlannerService(catalog(), undefined);
    const out = await svc.plan('điều phối lại toàn bộ đội xe', OP);
    expect(out.kind).toBe('clarify');
  });
});
