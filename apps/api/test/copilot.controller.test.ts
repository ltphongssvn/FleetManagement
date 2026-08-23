// apps/api/test/copilot.controller.test.ts
// RED-first unit spec for CopilotController: thin HTTP layer -- Zod-parse
// the untrusted body at the boundary (Axis 1), delegate to the executor
// with the JWT-derived OperatorContext, pass the result through. Invalid
// bodies raise ZodError (handled by the global ZodExceptionFilter) and
// must never reach the executor.
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { OperatorContext } from '@fleet/domain';
import type { CopilotExecutionResult } from '@fleet/sync-protocol';
import { CopilotController } from '../src/copilot/copilot.controller.js';
import type { CopilotPlannerService } from '../src/copilot/copilot-planner.service.js';

const GUID_PLAN = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const GUID_CMD = 'b4cc290f-9c0a-4999-aa23-bdf5f7654113';

const OP: OperatorContext = {
  operatorId: 'f8aa6d43-daf4-4ddd-8e67-f139cba98557',
  companyId: 'f9bb7e54-eb05-4eee-8f78-a24adcba9668',
  businessUnitId: 'aacc8f65-fc16-4aff-8a89-b35bedcba779',
  depotId: 'bbdd9a76-ad27-4b00-9b9a-c46cfedcb88a',
  legalEntityId: 'ccee0b87-be38-4c11-8cab-d57dafedc99b',
};

const VALID_BODY = {
  planId: GUID_PLAN,
  summaryVi: 'Sẽ tạo tên hàng Gạo',
  commands: [{ type: 'create_cargo_type', commandId: GUID_CMD, name: 'Gạo' }],
};

const RESULT: CopilotExecutionResult = {
  planId: GUID_PLAN,
  status: 'completed',
  results: [{ commandId: GUID_CMD, outcome: 'ok' }],
};

function build(): {
  ctrl: CopilotController;
  execute: ReturnType<typeof vi.fn>;
  plan: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(() => Promise.resolve(RESULT));
  const plan = vi.fn(() => Promise.resolve({ kind: 'clarify', questionVi: 'Xe nào?' }));
  const ctrl = new CopilotController(
    { execute } as never,
    { plan } as unknown as CopilotPlannerService,
  );
  return { ctrl, execute, plan };
}

describe('@fleet/api CopilotController', () => {
  it('parses a valid plan and delegates to the executor with op', async () => {
    const { ctrl, execute } = build();
    const out = await ctrl.execute(VALID_BODY, OP);
    expect(out).toBe(RESULT);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ planId: GUID_PLAN }), OP);
  });

  it('rejects an invalid body with ZodError before touching the executor', async () => {
    const { ctrl, execute } = build();
    await expect(ctrl.execute({ planId: 'not-a-guid' }, OP)).rejects.toBeInstanceOf(ZodError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('parses a plan request and delegates text + op to the planner', async () => {
    const { ctrl, plan } = build();
    const out = await ctrl.plan({ text: 'Thêm tên hàng Gạo' }, OP);
    expect(out).toEqual({ kind: 'clarify', questionVi: 'Xe nào?' });
    expect(plan).toHaveBeenCalledWith('Thêm tên hàng Gạo', OP);
  });

  it('rejects an empty or missing text with ZodError before the planner', async () => {
    const { ctrl, plan } = build();
    await expect(ctrl.plan({ text: '' }, OP)).rejects.toBeInstanceOf(ZodError);
    await expect(ctrl.plan({}, OP)).rejects.toBeInstanceOf(ZodError);
    expect(plan).not.toHaveBeenCalled();
  });

  it('rejects unknown keys on a command (strict producer payloads)', async () => {
    const { ctrl, execute } = build();
    const poisoned = {
      ...VALID_BODY,
      commands: [{ ...VALID_BODY.commands[0], tenantId: 'evil' }],
    };
    await expect(ctrl.execute(poisoned, OP)).rejects.toBeInstanceOf(ZodError);
    expect(execute).not.toHaveBeenCalled();
  });
});
