// apps/api/test/commands.controller.tx-failure.test.ts
// Verifies gateway.pushCommand is NOT called when service.persist throws.
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
const noopPolicy = {
  assertOperatorInTenant: () => Promise.resolve(),
  assertAggregateInTenant: () => Promise.resolve(),
} as unknown as TenantPolicy;

describe('@fleet/api - CommandsController tx failure isolation', () => {
  it('does NOT call gateway.pushCommand when service.persist rejects', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('db boom'));
    const pushCommand = vi.fn();
    const svc = { persist } as unknown as CommandsService;
    const gw = { pushCommand } as unknown as CommandsGateway;
    const ctrl = new CommandsController(gw, svc, noopPolicy);

    await expect(ctrl.issue(validBody, OP)).rejects.toThrow('db boom');
    expect(pushCommand).not.toHaveBeenCalled();
  });

  it('does NOT call gateway.pushCommand when tenantPolicy rejects', async () => {
    const persist = vi.fn();
    const pushCommand = vi.fn();
    const failingPolicy = {
      assertOperatorInTenant: () => Promise.reject(new Error('cross_tenant')),
      assertAggregateInTenant: () => Promise.resolve(),
    } as unknown as TenantPolicy;
    const svc = { persist } as unknown as CommandsService;
    const gw = { pushCommand } as unknown as CommandsGateway;
    const ctrl = new CommandsController(gw, svc, failingPolicy);

    await expect(ctrl.issue(validBody, OP)).rejects.toThrow('cross_tenant');
    expect(persist).not.toHaveBeenCalled();
    expect(pushCommand).not.toHaveBeenCalled();
  });
});
