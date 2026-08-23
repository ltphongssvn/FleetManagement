// apps/ops-web/test/reference-admin-client-session-expired.test.ts
// RED (T11 idle-timeout arc, P7 sweep): ReferenceAdminClient throws plain
// Error, so the page cannot branch on an idle-expired 401 -- every section
// rendered a dead-end banner. Pinned contract:
//   1. non-ok responses throw ApiProblemError carrying status + Zod-parsed
//      problem code (machine members), with the SAME display message the
//      T5b suite pins (detail > legacy message > status-class Vietnamese) --
//      the conflict-name extraction keeps working on .message unchanged.
//   2. the forwarder-shaped 401 (code UNAUTHORIZED, no detail) satisfies
//      isSessionExpired AND presents the friendly session-expired copy.
import { describe, it, expect, vi } from 'vitest';
import { ReferenceAdminClient } from '@/features/admin/reference-admin-client';
import { ApiProblemError } from '@/features/errors/api-problem-error';
import { isSessionExpired } from '@/features/auth/session-refresh-navigation';
import { VN_OPS_ERROR_MESSAGES } from '@/features/errors/present-problem';

function problemRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

describe('ReferenceAdminClient session-expired seam', () => {
  it('list() on the forwarder 401 -> ApiProblemError{401, UNAUTHORIZED}, session-expired display copy', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        problemRes(
          { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'UNAUTHORIZED' },
          401,
        ),
      ),
    );
    const client = new ReferenceAdminClient('customers', fetchFn);
    const err: unknown = await client.list().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiProblemError);
    const pe = err as ApiProblemError;
    expect(pe.status).toBe(401);
    expect(pe.code).toBe('UNAUTHORIZED');
    expect(isSessionExpired(err)).toBe(true);
    expect(pe.message).toBe(VN_OPS_ERROR_MESSAGES.UNAUTHORIZED);
  });

  it('create() 409 conflict keeps the pinned display message AND gains machine members', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        problemRes(
          {
            title: 'Conflict',
            status: 409,
            code: 'VALIDATION_FAILED',
            detail: 'Khách hàng "X" đã tồn tại',
          },
          409,
        ),
      ),
    );
    const client = new ReferenceAdminClient('customers', fetchFn);
    const err: unknown = await client.create('X').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiProblemError);
    const pe = err as ApiProblemError;
    expect(pe.status).toBe(409);
    expect(pe.message).toMatch(/đã tồn tại/);
    expect(isSessionExpired(err)).toBe(false);
  });
});
