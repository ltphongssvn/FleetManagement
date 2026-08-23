// apps/api/test/admin-id-param-validation.test.ts
// RED (follow-up #3, 2026-07-07): every admin :id route param must be
// validated as a UUID at the controller boundary. Prod evidence:
// DELETE /admin/drivers/NONE returned 500 INTERNAL (raw pg 22P02
// string_to_uuid) instead of 400. Contract: non-uuid param -> ZodError
// (global ZodExceptionFilter maps to 400) thrown BEFORE the service is
// touched; valid uuid flows through unchanged. Shared schema:
// UuidParamSchema in src/common/uuid-param.schema.ts (Zod SSOT).
import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { randomBytes } from 'node:crypto';
import { AdminAssignmentController } from '../src/admin/admin-assignment.controller.js';
import { AdminDriversResetPasswordController } from '../src/admin/admin-drivers-reset-password.controller.js';
import { AdminDriversUpdateController } from '../src/admin/admin-drivers-update.controller.js';
import { createOperatorContext } from '@fleet/test-fixtures';

const OP = createOperatorContext();
const GOOD = '11111111-2222-4333-8444-555555555555';
const BAD = 'not-a-uuid';

interface Calls {
  n: number;
}
function counted(result: unknown): { svc: unknown; calls: Calls } {
  const calls: Calls = { n: 0 };
  const svc = new Proxy(
    {},
    {
      get:
        () =>
        (..._a: unknown[]) => {
          calls.n += 1;
          return Promise.resolve(result);
        },
    },
  );
  return { svc, calls };
}

describe('admin :id param validation (UuidParamSchema at controller boundary)', () => {
  it('assignment revoke: non-uuid id rejects with ZodError, service untouched', async () => {
    const { svc, calls } = counted({ assignmentId: GOOD });
    const ctrl = new AdminAssignmentController(svc as never);
    await expect(ctrl.revoke(BAD, { reason: 'x' } as never)).rejects.toBeInstanceOf(ZodError);
    expect(calls.n).toBe(0);
  });
  it('assignment revoke: valid uuid reaches the service', async () => {
    const { svc, calls } = counted({ assignmentId: GOOD });
    const ctrl = new AdminAssignmentController(svc as never);
    await ctrl.revoke(GOOD, { reason: 'x' } as never);
    expect(calls.n).toBe(1);
  });
  it('reset-password: non-uuid id rejects with ZodError, service untouched', async () => {
    const { svc, calls } = counted(undefined);
    const ctrl = new AdminDriversResetPasswordController(svc as never);
    await expect(
      ctrl.reset(OP, BAD, { newPassword: randomBytes(9).toString('hex') } as never),
    ).rejects.toBeInstanceOf(ZodError);
    expect(calls.n).toBe(0);
  });
  it('update: non-uuid id rejects with ZodError, service untouched', async () => {
    const { svc, calls } = counted(undefined);
    const ctrl = new AdminDriversUpdateController(svc as never);
    await expect(ctrl.update(OP, BAD, { fullName: 'X' } as never)).rejects.toBeInstanceOf(ZodError);
    expect(calls.n).toBe(0);
  });
  it('softDelete: non-uuid id rejects with ZodError, service untouched', async () => {
    const { svc, calls } = counted(undefined);
    const ctrl = new AdminDriversUpdateController(svc as never);
    await expect(ctrl.softDelete(OP, BAD)).rejects.toBeInstanceOf(ZodError);
    expect(calls.n).toBe(0);
  });
  it('softDelete: valid uuid reaches the service', async () => {
    const { svc, calls } = counted(undefined);
    const ctrl = new AdminDriversUpdateController(svc as never);
    await ctrl.softDelete(OP, GOOD);
    expect(calls.n).toBe(1);
  });
});
