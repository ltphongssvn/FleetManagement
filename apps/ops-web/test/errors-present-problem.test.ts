// apps/ops-web/test/errors-present-problem.test.ts
// RED-first (Phase 4.1): vnApiErrorMessage is the ops-web presentation seam.
// Server actions currently return raw transport text in message ("API request
// failed: 500 Internal Server Error") and DISCARD the RFC 9457 body -- the
// dispatcher-side twin of the driver-app banner defect. This pure function is
// called at every action''s !res.ok branch (and admin catch sites keep fixed
// Vietnamese copy), so forms keep rendering result.message unchanged while
// the content becomes friendly Vietnamese with next-step guidance. Mapped
// code -> immutable dispatcher copy (Record keyed by the strict
// FleetErrorCode union: adding a contract code forces copy at typecheck
// time); unmapped/unknown -> status class; non-envelope body -> status
// class; out-of-range status -> caller fallback. Machine tokens are never
// echoed. Written before src/features/errors/present-problem.ts exists ->
// fails at import resolution until the module lands.
import { describe, it, expect } from 'vitest';
import {
  vnApiErrorMessage,
  vnExceptionMessage,
  VN_OPS_ERROR_MESSAGES,
  VN_OPS_STATUS_FALLBACKS,
  VN_OPS_GENERIC_ERROR,
} from '../src/features/errors/present-problem';

const ENVELOPE = {
  title: 'Conflict',
  status: 409,
  detail: 'Cannot cancel an order in its current state.',
  code: 'INVALID_STATE_TRANSITION',
};

describe('ops-web vnApiErrorMessage', () => {
  it('maps mapped codes to immutable dispatcher Vietnamese', () => {
    expect(vnApiErrorMessage(409, ENVELOPE)).toBe(VN_OPS_ERROR_MESSAGES.INVALID_STATE_TRANSITION);
    expect(VN_OPS_ERROR_MESSAGES.INVALID_STATE_TRANSITION).toBe(
      'Không thể thực hiện: trạng thái đơn đã thay đổi. Vui lòng tải lại danh sách.',
    );
    expect(vnApiErrorMessage(401, { status: 401, code: 'UNAUTHORIZED' })).toBe(
      'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.',
    );
  });

  it('keys the copy Record by the strict contract union', () => {
    const keys = Object.keys(VN_OPS_ERROR_MESSAGES).sort();
    expect(keys).toEqual([
      'DEVICE_NOT_REGISTERED',
      'DEVICE_PENDING_APPROVAL',
      'DEVICE_REVOKED',
      'DRIVER_ALREADY_ASSIGNED',
      'FORBIDDEN',
      'INTERNAL',
      'INVALID_STATE_TRANSITION',
      'MANIFESTS_INCOMPLETE',
      'NOT_FOUND',
      'UNAUTHORIZED',
      'VALIDATION_FAILED',
      'VEHICLE_ALREADY_ASSIGNED',
    ]);
  });

  it('falls to the status class for unknown future codes, never echoing them', () => {
    const msg = vnApiErrorMessage(409, { status: 409, code: 'A_CODE_FROM_THE_FUTURE' });
    expect(msg).toBe(VN_OPS_STATUS_FALLBACKS.clientError);
    expect(msg.includes('A_CODE_FROM_THE_FUTURE')).toBe(false);
  });

  it('falls to the status class for non-envelope bodies', () => {
    expect(vnApiErrorMessage(404, { error: 'Not Found' })).toBe(VN_OPS_STATUS_FALLBACKS.notFound);
    expect(vnApiErrorMessage(400, 'Bad Request')).toBe(VN_OPS_STATUS_FALLBACKS.clientError);
    expect(vnApiErrorMessage(503, undefined)).toBe(VN_OPS_STATUS_FALLBACKS.serverError);
  });

  it('uses the caller fallback (default generic) for out-of-range statuses', () => {
    expect(vnApiErrorMessage(0, undefined)).toBe(VN_OPS_GENERIC_ERROR);
    expect(vnApiErrorMessage(302, undefined, 'Ctx')).toBe('Ctx');
  });

  it('never leaks transport text on any branch', () => {
    const cases: readonly (readonly [number, unknown])[] = [
      [409, ENVELOPE],
      [500, { message: 'pg password hunter2 at 10.0.0.7' }],
      [400, 'API request failed: 400 Bad Request'],
      [404, undefined],
      [0, undefined],
    ];
    for (const [status, body] of cases) {
      const msg = vnApiErrorMessage(status, body);
      expect(msg.includes('API request failed')).toBe(false);
      expect(msg.includes('http')).toBe(false);
      expect(msg.includes('HTTP')).toBe(false);
      expect(msg.includes('hunter2')).toBe(false);
      expect(msg.includes('POST')).toBe(false);
    }
  });

  it('vnExceptionMessage maps leading-status exception messages by class', () => {
    expect(vnExceptionMessage(new Error('404 Not Found'), 'Ctx')).toBe(
      VN_OPS_STATUS_FALLBACKS.notFound,
    );
    expect(vnExceptionMessage(new Error('500 Internal Server Error'), 'Ctx')).toBe(
      VN_OPS_STATUS_FALLBACKS.serverError,
    );
    expect(vnExceptionMessage(new Error('418 teapot'), 'Ctx')).toBe(
      VN_OPS_STATUS_FALLBACKS.clientError,
    );
  });

  it('vnExceptionMessage returns the fixed copy for everything else, leaking nothing', () => {
    expect(vnExceptionMessage(new Error('pg password hunter2'), 'Ctx')).toBe('Ctx');
    expect(vnExceptionMessage('boom', 'Ctx')).toBe('Ctx');
    expect(vnExceptionMessage(undefined, 'Ctx')).toBe('Ctx');
  });
});
