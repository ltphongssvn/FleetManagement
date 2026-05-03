// apps/api/test/commands.controller.push-failure.test.ts
// Verifies controller does not 500 if gateway.pushCommand throws.
// DB commit already succeeded (durable); push is best-effort.
import { describe, it, expect, vi } from 'vitest';
import { CommandsController } from '../src/commands/commands.controller.js';
import type { CommandsService } from '../src/commands/commands.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';
import type { TenantPolicy } from '../src/auth/tenant-policy.js';
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

describe('@fleet/api - CommandsController push failure isolation', () => {
  it('returns success even when gateway.pushCommand throws (DB already committed)', async () => {
    const persist = vi.fn().mockResolvedValue({ duplicate: false });
    const pushCommand = vi.fn().mockImplementation(() => {
      throw new Error('socket.io adapter unavailable');
    });
    const svc = { persist } as unknown as CommandsService;
    const gw = { pushCommand } as unknown as CommandsGateway;
    const ctrl = new CommandsController(gw, svc, { assertOperatorInTenant: () => Promise.resolve(), assertAggregateInTenant: () => Promise.resolve() } as unknown as TenantPolicy);

    const result = await ctrl.issue(validBody, OP);

    expect(persist).toHaveBeenCalledOnce();
    expect(result.commandId).toBe(validBody.commandId);
    // Push failed but DB committed; surface as no_socket so reconciler/sync picks up.
    expect(result.status).toBe('no_socket');
    expect(result.recipientCount).toBe(0);
  });
});
