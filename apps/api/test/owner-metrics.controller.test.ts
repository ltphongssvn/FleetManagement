// apps/api/test/owner-metrics.controller.test.ts
// RED: GET /owner/metrics/adoption. Controller is a thin pass-through to
// OwnerMetricsService.adoption, scoped to the JWT operator's company
// (CurrentOperator), never a query string. Guards (JwtGuard + OwnerRoleGuard)
// are asserted structurally via reflect-metadata; the delegation + tenancy are
// asserted by direct invocation with a mocked service.
import { describe, it, expect, vi } from 'vitest';
import { OwnerMetricsController } from '../src/owner/owner-metrics.controller.js';
import { OwnerRoleGuard } from '../src/owner/owner-role.guard.js';
import { JwtGuard } from '../src/auth/jwt.guard.js';
import type { OperatorContext } from '../src/auth/operator-context.js';
import type { OwnerAdoptionMetrics } from '@fleet/sync-protocol';

const op: OperatorContext = Object.freeze({
  operatorId: '00000000-0000-0000-0000-0000000000bb',
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '00000000-0000-0000-0000-000000000000',
  depotId: '00000000-0000-0000-0000-000000000000',
  legalEntityId: '00000000-0000-0000-0000-000000000000',
});

const sample: OwnerAdoptionMetrics = {
  totalDrivers: 5,
  deviceRegistered: 4,
  appInstalled: 3,
  activeToday: 2,
  notInstalled: 2,
  asOf: '2026-07-06T08:00:00.000Z',
  day: '2026-07-06',
};

function makeService(): { adoption: ReturnType<typeof vi.fn> } {
  return { adoption: vi.fn().mockResolvedValue(sample) };
}

describe('@fleet/api - OwnerMetricsController', () => {
  it('delegates to OwnerMetricsService.adoption scoped to the operator company', async () => {
    const svc = makeService();
    const controller = new OwnerMetricsController(svc as never);
    const res = await controller.adoption(op);
    expect(svc.adoption).toHaveBeenCalledWith({ companyId: op.companyId });
    expect(res).toEqual(sample);
  });

  it('does not read tenancy from any argument other than CurrentOperator', async () => {
    const svc = makeService();
    const controller = new OwnerMetricsController(svc as never);
    await controller.adoption(op);
    const arg = svc.adoption.mock.calls[0]?.[0] as { companyId: string };
    expect(Object.keys(arg)).toEqual(['companyId']);
    expect(arg.companyId).toBe(op.companyId);
  });

  it('is protected by JwtGuard and OwnerRoleGuard at the class level', () => {
    const guards = Reflect.getMetadata('__guards__', OwnerMetricsController) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards).toContain(JwtGuard);
    expect(guards).toContain(OwnerRoleGuard);
  });
});
