// apps/ops-web/test/admin-drivers-client-problem-error.test.ts
// RED (T11 idle-timeout arc, D5): the admin client throws
// Error('/admin/drivers HTTP 401') -- status TRAILING -- while the presenter
// contract (vnExceptionMessage) maps only a LEADING 3-digit status. Result:
// the friendly UNAUTHORIZED copy is unreachable and dispatchers saw the raw
// 'load failed' fallback (prod screenshot 2026-07-11). Pinned contract:
//   1. every !ok response throws ApiProblemError (features/errors SSOT)
//      whose message STARTS with the status so the existing presenter regex
//      fires, carrying .status + the Zod-parsed problem code (trust boundary,
//      no cast).
//   2. vnExceptionMessage(ApiProblemError 401 UNAUTHORIZED) === the immutable
//      Vietnamese copy 'Phien dang nhap het han...' (asserted via the SSOT
//      record, never retyped).
//   3. non-problem bodies still map through the status class.
//   4. mutations ride the same seam (create -> VALIDATION_FAILED copy).
import { describe, it, expect, vi } from 'vitest';
import { AdminDriversClient } from '@/features/admin/admin-drivers-client';
import { ApiProblemError } from '@/features/errors/api-problem-error';
import {
  vnExceptionMessage,
  VN_OPS_ERROR_MESSAGES,
  VN_OPS_STATUS_FALLBACKS,
} from '@/features/errors/present-problem';

const PROBLEM_CT = 'application/problem+json';

function problemResponse(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: 'x', status, code }),
    { status, headers: { 'content-type': PROBLEM_CT } },
  );
}

function makeClient(fetchFn: typeof globalThis.fetch): AdminDriversClient {
  return new AdminDriversClient({ fetchFn });
}

describe('AdminDriversClient throws ApiProblemError the presenter can map', () => {
  it('list() on 401 problem+json -> ApiProblemError{status,code}, message starts with the status', async () => {
    const client = makeClient(vi.fn(() => Promise.resolve(problemResponse(401, 'UNAUTHORIZED'))));
    const err: unknown = await client.list().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiProblemError);
    const pe = err as ApiProblemError;
    expect(pe.status).toBe(401);
    expect(pe.code).toBe('UNAUTHORIZED');
    expect(/^401\b/.test(pe.message)).toBe(true);
  });

  it('presenter drift FIXED: vnExceptionMessage maps the 401 to the friendly session-expired copy', async () => {
    const client = makeClient(vi.fn(() => Promise.resolve(problemResponse(401, 'UNAUTHORIZED'))));
    const err: unknown = await client.list().then(
      () => null,
      (e: unknown) => e,
    );
    expect(vnExceptionMessage(err, 'load failed')).toBe(VN_OPS_ERROR_MESSAGES.UNAUTHORIZED);
  });

  it('non-problem 500 body -> ApiProblemError status 500, code undefined, server-error copy', async () => {
    const client = makeClient(
      vi.fn(() => Promise.resolve(new Response('oops', { status: 500 }))),
    );
    const err: unknown = await client.list().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiProblemError);
    const pe = err as ApiProblemError;
    expect(pe.status).toBe(500);
    expect(pe.code).toBeUndefined();
    expect(vnExceptionMessage(err, 'load failed')).toBe(VN_OPS_STATUS_FALLBACKS.serverError);
  });

  it('mutations ride the same seam: create() on 400 VALIDATION_FAILED -> validation copy', async () => {
    const client = makeClient(
      vi.fn(() => Promise.resolve(problemResponse(400, 'VALIDATION_FAILED'))),
    );
    const err: unknown = await client
      .create({ fullName: 'NGUYEN VAN A', phone: '0900000001', password: 'secret1' }) // pragma: allowlist secret
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ApiProblemError);
    expect(vnExceptionMessage(err, 'x')).toBe(VN_OPS_ERROR_MESSAGES.VALIDATION_FAILED);
  });

  it('happy path unchanged: list() on 200 returns rows without throwing', async () => {
    const rows = [{ driverId: 'd1' }];
    const client = makeClient(
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(rows), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    await expect(client.list()).resolves.toEqual(rows);
  });
});
