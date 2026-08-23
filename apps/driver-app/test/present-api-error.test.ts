// apps/driver-app/test/present-api-error.test.ts
// RED-first (Phase 3.2): presentApiError is the ONE function between any
// thrown error and driver-visible text -- the choke point that makes the raw
// "POST <url> HTTP 400" banner structurally impossible. Policy pinned here:
//   1) ApiError with a mapped code -> that code''s immutable Vietnamese
//      message with next-step guidance (INVALID_STATE_TRANSITION carries the
//      complete-transition copy specified for the field incident).
//   2) ApiError, unmapped/absent code -> status-class Vietnamese fallback
//      (401/403 auth copy, 404 not-found, other 4xx generic-check, 5xx
//      server-side copy).
//   3) Anything else (bare Error from WebSocket/parse paths, strings) -> the
//      CALLER''s context fallback (screens pass their existing copy such as
//      "Loi tai du lieu").
//   4) Structural guarantee: output NEVER contains http(s)://, "POST ", or
//      raw Error.message text -- asserted across every branch.
// Vietnamese strings are immutable contracts and are asserted VERBATIM.
// Written before src/errors/present-api-error.ts exists -> fails at import
// resolution until the presenter lands.
import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/errors/api-error.js';
import {
  presentApiError,
  VN_ERROR_MESSAGES,
  VN_STATUS_FALLBACKS,
  VN_GENERIC_ERROR,
} from '../src/errors/present-api-error.js';

const FALLBACK = 'Loi tai du lieu';

function conflict(): ApiError {
  return ApiError.fromBody(409, {
    status: 409,
    detail: 'Cannot complete a run that has not been started.',
    code: 'INVALID_STATE_TRANSITION',
  });
}

describe('driver-app presentApiError', () => {
  it('maps INVALID_STATE_TRANSITION to the immutable transition message', () => {
    const msg = presentApiError(conflict(), FALLBACK);
    expect(msg).toBe(
      String.fromCharCode(
        75,
        104,
        244,
        110,
        103,
        32,
        116,
        104,
        7875,
        32,
        104,
        111,
        224,
        110,
        32,
        116,
        104,
        224,
        110,
        104,
        32,
        99,
        104,
        117,
        121,
        7871,
        110,
        46,
        32,
        86,
        117,
        105,
        32,
        108,
        242,
        110,
        103,
        32,
        107,
        105,
        7875,
        109,
        32,
        116,
        114,
        97,
        32,
        116,
        114,
        7841,
        110,
        103,
        32,
        116,
        104,
        225,
        105,
        32,
        273,
        417,
        110,
        46,
      ),
    );
    expect(msg).toBe(VN_ERROR_MESSAGES.INVALID_STATE_TRANSITION);
  });

  it('maps UNAUTHORIZED and FORBIDDEN to the auth message', () => {
    const un = ApiError.fromBody(401, { status: 401, code: 'UNAUTHORIZED' });
    const fb = ApiError.fromBody(403, { status: 403, code: 'FORBIDDEN' });
    expect(presentApiError(un, FALLBACK)).toBe(VN_ERROR_MESSAGES.UNAUTHORIZED);
    expect(presentApiError(fb, FALLBACK)).toBe(VN_ERROR_MESSAGES.FORBIDDEN);
    expect(
      VN_ERROR_MESSAGES.UNAUTHORIZED.includes(
        String.fromCharCode(273, 259, 110, 103, 32, 110, 104, 7853, 112),
      ),
    ).toBe(true);
  });

  it('falls back by status class for an ApiError without a mapped code', () => {
    const teapot = ApiError.fromBody(418, { status: 418 });
    const server = ApiError.fromBody(503, 'Bad Gateway');
    const notFound = ApiError.fromBody(404, { status: 404 });
    expect(presentApiError(teapot, FALLBACK)).toBe(VN_STATUS_FALLBACKS.clientError);
    expect(presentApiError(server, FALLBACK)).toBe(VN_STATUS_FALLBACKS.serverError);
    expect(presentApiError(notFound, FALLBACK)).toBe(VN_STATUS_FALLBACKS.notFound);
  });

  it('maps an unknown future code by status class, never by echoing the code', () => {
    const future = ApiError.fromBody(409, { status: 409, code: 'A_CODE_FROM_THE_FUTURE' });
    const msg = presentApiError(future, FALLBACK);
    expect(msg).toBe(VN_STATUS_FALLBACKS.clientError);
    expect(msg.includes('A_CODE_FROM_THE_FUTURE')).toBe(false);
  });

  it('returns the caller context fallback for non-ApiError inputs', () => {
    expect(presentApiError(new Error('socket closed 10.0.0.7'), FALLBACK)).toBe(FALLBACK);
    expect(presentApiError('boom', FALLBACK)).toBe(FALLBACK);
    expect(presentApiError(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('uses the shared generic when the caller passes no fallback', () => {
    expect(presentApiError(new Error('x'))).toBe(VN_GENERIC_ERROR);
  });

  it('never leaks URLs, POST lines, or raw error text on ANY branch', () => {
    const rawBanner = new Error(
      'POST https://api-production-fd42.up.railway.app/driver/assignments/8269d97f/complete HTTP 400 bad request',
    );
    const inputs: readonly unknown[] = [
      conflict(),
      ApiError.fromBody(500, undefined),
      ApiError.fromBody(404, { status: 404 }),
      rawBanner,
      'POST /x HTTP 400',
      undefined,
    ];
    for (const input of inputs) {
      const msg = presentApiError(input, FALLBACK);
      expect(msg.includes('http')).toBe(false);
      expect(msg.includes('HTTP')).toBe(false);
      expect(msg.includes('POST')).toBe(false);
      expect(msg.includes('railway.app')).toBe(false);
      expect(msg.includes('bad request')).toBe(false);
    }
  });
});
