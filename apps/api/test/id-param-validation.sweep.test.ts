// apps/api/test/id-param-validation.sweep.test.ts
// RED (follow-up #3 sweep, 2026-07-07): remaining unvalidated :id / :roadRunId
// route params outside admin/. Same contract as admin-id-param-validation:
// non-uuid -> ZodError before the service is touched; valid uuid flows through.
import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { DriverDeliveryController } from '../src/dispatch/driver-delivery.controller.js';
import { ReferenceController } from '../src/reference/reference.controller.js';
import { createOperatorContext } from '@fleet/test-fixtures';

const OP = createOperatorContext();
const GOOD = '11111111-2222-4333-8444-555555555555';
const BAD = 'not-a-uuid';

interface Calls { n: number }
function counted(result: unknown): { svc: unknown; calls: Calls } {
  const calls: Calls = { n: 0 };
  const svc = new Proxy({}, {
    get: () => (..._a: unknown[]) => { calls.n += 1; return Promise.resolve(result); },
  });
  return { svc, calls };
}

describe('driver-delivery :roadRunId validation', () => {
  const cases = ['accept', 'start', 'complete'] as const;
  for (const m of cases) {
    it(m + ': non-uuid roadRunId rejects with ZodError, service untouched', () => {
      const { svc, calls } = counted({ ok: true });
      const ctrl = new DriverDeliveryController(svc as never);
      const fn = ctrl[m] as (id: string, op: unknown) => Promise<unknown>;
      // Handlers are non-async: parse throws synchronously (Nest filter -> 400 either way).
      expect(() => fn.call(ctrl, BAD, OP)).toThrow(ZodError);
      expect(calls.n).toBe(0);
    });
  }
  it('accept: valid uuid reaches the service', async () => {
    const { svc, calls } = counted({ ok: true });
    const ctrl = new DriverDeliveryController(svc as never);
    await ctrl.accept(GOOD, OP);
    expect(calls.n).toBe(1);
  });
});

describe('reference CRUD :id validation', () => {
  const updates = ['updateCustomer', 'updateCargoType', 'updateVehicle', 'updateWarehouse'] as const;
  const deletes = ['deleteCustomer', 'deleteCargoType', 'deleteVehicle', 'deleteWarehouse'] as const;
  for (const m of updates) {
    it(m + ': non-uuid id rejects with ZodError, service untouched', () => {
      const { svc, calls } = counted(undefined);
      const ctrl = new ReferenceController(svc as never);
      const fn = ctrl[m] as (op: unknown, id: string, body: unknown) => Promise<void>;
      expect(() => fn.call(ctrl, OP, BAD, { name: 'X' })).toThrow(ZodError);
      expect(calls.n).toBe(0);
    });
  }
  for (const m of deletes) {
    it(m + ': non-uuid id rejects with ZodError, service untouched', () => {
      const { svc, calls } = counted(undefined);
      const ctrl = new ReferenceController(svc as never);
      const fn = ctrl[m] as (op: unknown, id: string) => Promise<void>;
      expect(() => fn.call(ctrl, OP, BAD)).toThrow(ZodError);
      expect(calls.n).toBe(0);
    });
  }
  it('updateCustomer: valid uuid reaches the service', async () => {
    const { svc, calls } = counted(undefined);
    const ctrl = new ReferenceController(svc as never);
    await ctrl.updateCustomer(OP, GOOD, { name: 'X' });
    expect(calls.n).toBe(1);
  });
  it('deleteWarehouse: valid uuid reaches the service', async () => {
    const { svc, calls } = counted(undefined);
    const ctrl = new ReferenceController(svc as never);
    await ctrl.deleteWarehouse(OP, GOOD);
    expect(calls.n).toBe(1);
  });
});
