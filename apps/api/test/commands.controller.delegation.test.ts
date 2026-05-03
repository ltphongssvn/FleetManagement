// apps/api/test/commands.controller.delegation.test.ts
// Pure unit test: controller is a thin HTTP layer that delegates to CommandsService.
// No DB. No transactions. Just: parse body -> call service -> map to response.
import { describe, it, expect, vi } from 'vitest';
import { CommandsController } from '../src/commands/commands.controller.js';
import type { CommandsService } from '../src/commands/commands.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

const OP: OperatorContext = {
  operatorId: '00000000-0000-0000-0000-0000000000a1',
  companyId: '00000000-0000-0000-0000-0000000000a2',
  businessUnitId: '00000000-0000-0000-0000-0000000000a3',
  depotId: '00000000-0000-0000-0000-0000000000a4',
  legalEntityId: '00000000-0000-0000-0000-0000000000a5',
};

const validBody = {
  commandId: '11111111-1111-7111-8111-111111111111',
  type: 'assign_run',
  targetOperatorId: '22222222-2222-7222-8222-222222222222',
  aggregateType: 'road_run',
  aggregateId: '33333333-3333-7333-8333-333333333333',
  payload: {},
  issuedAt: '2026-05-02T10:00:00.000Z',
};

describe('@fleet/api - CommandsController (thin HTTP layer)', () => {
  it('delegates to CommandsService.persist and pushes via gateway', async () => {
    const persist = vi.fn().mockResolvedValue({ duplicate: false });
    const pushCommand = vi.fn().mockReturnValue({ status: 'emitted', recipientCount: 1, room: 'operator:x' });
    const svc = { persist } as unknown as CommandsService;
    const gw = { pushCommand } as unknown as CommandsGateway;
    const ctrl = new (CommandsController as unknown as new (g: CommandsGateway, s: CommandsService) => CommandsController)(gw, svc);

    const result = await ctrl.issue(validBody, OP);

    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ commandId: validBody.commandId }), OP);
    expect(pushCommand).toHaveBeenCalledOnce();
    expect(result.status).toBe('emitted');
    expect(result.recipientCount).toBe(1);
  });

  it('does not push when service reports duplicate (replay)', async () => {
    const persist = vi.fn().mockResolvedValue({ duplicate: true });
    const pushCommand = vi.fn();
    const svc = { persist } as unknown as CommandsService;
    const gw = { pushCommand } as unknown as CommandsGateway;
    const ctrl = new (CommandsController as unknown as new (g: CommandsGateway, s: CommandsService) => CommandsController)(gw, svc);

    const result = await ctrl.issue(validBody, OP);

    expect(persist).toHaveBeenCalledOnce();
    expect(pushCommand).not.toHaveBeenCalled();
    expect(result.commandId).toBe(validBody.commandId);
  });
});
