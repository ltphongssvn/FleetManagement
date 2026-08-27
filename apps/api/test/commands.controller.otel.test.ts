// apps/api/test/commands.controller.otel.test.ts
// Verifies controller emits OTel attributes on HTTP path (matches gateway pattern).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandsController } from '../src/commands/commands.controller.js';
import type { CommandsService } from '../src/commands/commands.service.js';
import type { CommandsGateway } from '../src/commands/commands.gateway.js';
import type { TenantPolicy } from '../src/auth/tenant-policy.js';
import type { OperatorContext } from '../src/auth/operator-context.js';

const captured: Record<string, string | number | boolean>[] = [];
vi.mock('../src/observability/otel.js', () => ({
  tagActiveSpan: (attrs: Record<string, string | number | boolean>) => {
    captured.push(attrs);
  },
}));

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

describe('@fleet/api - CommandsController OTel attributes', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('tags span with command.id, target_operator, outcome on success', async () => {
    const svc = {
      persist: vi.fn().mockResolvedValue({ duplicate: false }),
    } as unknown as CommandsService;
    const gw = {
      pushCommand: vi.fn().mockReturnValue({ status: 'emitted', recipientCount: 1, room: 'r' }),
    } as unknown as CommandsGateway;
    const ctrl = new CommandsController(gw, svc, {
      assertOperatorInTenant: () => Promise.resolve(),
      assertAggregateInTenant: () => Promise.resolve(),
    } as unknown as TenantPolicy);
    await ctrl.issue(validBody, OP);
    const tagged = captured.find((a) => a['command.outcome'] === 'persisted');
    expect(tagged).toBeDefined();
    expect(tagged?.['command.id']).toBe(validBody.commandId);
    expect(tagged?.['command.target_operator']).toBe(validBody.targetOperatorId);
  });

  it('tags duplicate outcome on replay', async () => {
    const svc = {
      persist: vi.fn().mockResolvedValue({ duplicate: true }),
    } as unknown as CommandsService;
    const gw = { pushCommand: vi.fn() } as unknown as CommandsGateway;
    const ctrl = new CommandsController(gw, svc, {
      assertOperatorInTenant: () => Promise.resolve(),
      assertAggregateInTenant: () => Promise.resolve(),
    } as unknown as TenantPolicy);
    await ctrl.issue(validBody, OP);
    expect(captured.some((a) => a['command.outcome'] === 'duplicate')).toBe(true);
  });
});
