// apps/api/test/dispatch-roster-split.controller.test.ts
// RED: DispatchRosterSplitController - GET /dispatch/roster-split.
//
// TENANCY IS NOT NEGOTIABLE. companyId comes from the JWT operator context,
// never from a query string or body. A caller must not be able to read another
// company roster by editing a URL, so the controller is asserted to pass the
// operator company through and nothing else - this is the IDOR guard.
//
// The controller is a thin pass-through: all the split logic lives in the
// service (proved by the PGlite integration suite). What is proved HERE is the
// seam - route path, guard set, and the tenancy source.
//
// TWO LINT-DRIVEN SHAPES WORTH KEEPING. The service is imported with
// import type: it is only ever used in a type position here (the mock is cast
// to it), and consistent-type-imports requires the type-only form. And the
// route metadata is read through a property DESCRIPTOR rather than
// Controller.prototype.rosterSplit, because naming a method as a value trips
// unbound-method - the descriptor carries the same function without creating
// an unbound reference.
import { describe, it, expect, vi } from 'vitest';
import { DispatchRosterSplitController } from '../src/dispatch/dispatch-roster-split.controller.js';
import type { DispatchRosterSplitService } from '../src/dispatch/dispatch-roster-split.service.js';
import { JwtGuard } from '../src/auth/jwt.guard.js';
import type { DispatchRosterSplit } from '@fleet/sync-protocol';
import type { OperatorContext } from '../src/auth/operator-context.js';

const COMPANY = '00000000-0000-0000-0000-000000000000';

const SPLIT: DispatchRosterSplit = {
  day: '2026-08-01',
  asOf: '2026-08-01T05:00:00.000Z',
  totalDrivers: 1,
  dispatched: [],
  idle: [
    {
      driverId: '11111111-1111-4111-8111-111111111111',
      driverName: 'LÊ VĂN CHÂU',
      vehiclePlate: '51A-12345',
      reason: 'no_dispatch_today',
    },
  ],
};

function operator(companyId: string): OperatorContext {
  return { companyId } as OperatorContext;
}

function controllerWithSplit(): {
  controller: DispatchRosterSplitController;
  split: ReturnType<typeof vi.fn>;
} {
  const split = vi.fn().mockResolvedValue(SPLIT);
  const svc = { split } as unknown as DispatchRosterSplitService;
  return { controller: new DispatchRosterSplitController(svc), split };
}

describe('@fleet/api - DispatchRosterSplitController', () => {
  it('returns the service payload unchanged', async () => {
    const { controller } = controllerWithSplit();
    const result = await controller.rosterSplit(operator(COMPANY));
    expect(result).toEqual(SPLIT);
  });

  it('scopes the query to the JWT operator company, not to any request input', async () => {
    const { controller, split } = controllerWithSplit();
    await controller.rosterSplit(operator(COMPANY));
    expect(split).toHaveBeenCalledWith({ companyId: COMPANY });
  });

  it('passes a DIFFERENT operator company through unchanged (no hard-coded tenant)', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const { controller, split } = controllerWithSplit();
    await controller.rosterSplit(operator(other));
    expect(split).toHaveBeenCalledWith({ companyId: other });
  });

  it('is mounted at the dispatch/roster-split route', () => {
    const controllerPath = Reflect.getMetadata('path', DispatchRosterSplitController) as string;
    const descriptor = Object.getOwnPropertyDescriptor(
      DispatchRosterSplitController.prototype,
      'rosterSplit',
    );
    const handler = descriptor?.value as object;
    const methodPath = Reflect.getMetadata('path', handler) as string;
    expect(controllerPath).toBe('dispatch');
    expect(methodPath).toBe('roster-split');
  });

  it('is protected by JwtGuard', () => {
    const guards = Reflect.getMetadata('__guards__', DispatchRosterSplitController) as unknown[];
    expect(guards).toContain(JwtGuard);
  });
});
