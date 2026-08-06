// apps/api/test/copilot-planner.service.test.ts
// RED-first spec for CopilotPlannerService: text -> CopilotPlanResponse.
// Deterministic quick-grammar first (zero LLM); otherwise the LLM port
// proposes an UNTRUSTED draft that is Zod-parsed and RESOLVED against the
// catalog (plate/name -> ids). Ambiguity or misses -> clarify, never guess.
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
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
  // RED 1 -- EXECUTION-error class. 2026 practice splits semantic errors (a
  // bad shape, covered above) from execution errors (provider 429/5xx,
  // network, parse throw). Production answered HTTP 500 because the port call
  // was unguarded and a rejection propagated out of plan(). The palette
  // already owns a rule-based fallback, so a failure in the OPTIONAL
  // enrichment path must degrade to it, never take the endpoint down.
  it('clarifies when the LLM port REJECTS (provider failure, not a bad shape)', async () => {
    const llm: CopilotLlmPort = {
      proposeDraft: vi.fn(() => Promise.reject(new Error('anthropic messages HTTP 529'))),
    };
    const svc = new CopilotPlannerService(catalog(), llm);
    const out = await svc.plan('Thêm tài xế Nguyễn Văn B 0900000456', OP);
    expect(out.kind).toBe('clarify');
  });

  // RED 2 -- the fallback must NOT become a silent misfire. The documented
  // 2026 failure mode is a system that logs success while serving a fallback
  // nobody tested; a degraded path leaving no trace is exactly why this took a
  // live production request to discover. Degrading is necessary; silence is not.
  it('LOGS the provider failure when it degrades to clarify', async () => {
    const llm: CopilotLlmPort = {
      proposeDraft: vi.fn(() => Promise.reject(new Error('anthropic messages HTTP 529'))),
    };
    const svc = new CopilotPlannerService(catalog(), llm);
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await svc.plan('Thêm tài xế Nguyễn Văn B 0900000456', OP);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // RED 3 -- ONE SSOT drives BOTH the sampler grammar and the validator. The
  // planner owns DraftSchema and hands the port a JSON Schema derived from it,
  // so the adapter can constrain generation without ever defining a schema of
  // its own. z.strictObject yields additionalProperties false, which the
  // provider requires for structured outputs.
  it('hands the port a JSON Schema derived from DraftSchema', async () => {
    const llm = llmReturning({
      summaryVi: 'Sẽ tạo tài xế',
      commands: [{ type: 'create_driver', fullName: 'Nguyễn Văn B', phone: '0900000456' }],
    });
    const svc = new CopilotPlannerService(catalog(), llm);
    await svc.plan('Thêm tài xế Nguyễn Văn B 0900000456', OP);
    const calls = (llm.proposeDraft as unknown as {
      mock: { calls: [string, Record<string, unknown>][] };
    }).mock.calls;
    const first = calls[0];
    expect(first).toBeDefined();
    const schema = first?.[1];
    expect(schema).toBeDefined();
    if (schema === undefined) throw new Error('expected a schema argument');
    expect(schema['type']).toBe('object');
    expect(schema['additionalProperties']).toBe(false);
    expect(Object.keys(schema['properties'] as object)).toEqual(
      expect.arrayContaining(['summaryVi', 'commands']),
    );
  });
});
