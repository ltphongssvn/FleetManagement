// apps/api/test/problem-details-filter-extensions.test.ts
// RED-first (forgiving-FSM arc, U2): the ProblemDetailsExceptionFilter must
// pass an EXPLICIT extensions member from an HttpException response object
// through to the envelope body -- the seam the 409 INVALID_STATE_TRANSITION
// rejection uses to ship { currentState, allowedActions } (and the manifest
// gate { committed, required }). Passthrough is OPT-IN (a named extensions
// object, never a blind spread of the whole response) and SHIELDED: RFC 9457
// reserved envelope members (type/title/status/detail/instance/code) in the
// extensions object are IGNORED so a producer bug can never overwrite the
// envelope or reinstate the leak class the filter exists to kill.
// Fails now: the filter drops the extensions member entirely.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import {
  parseProblemDetails,
  parseInvalidStateTransitionExtensions,
} from '@fleet/sync-protocol';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nestjs', () => ({ captureException: mockCaptureException }));

import { ProblemDetailsExceptionFilter } from '../src/common/problem-details-exception.filter.js';

interface MockRes {
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}
function makeHost(): { host: ArgumentsHost; res: MockRes } {
  const res: Partial<MockRes> = { setHeader: vi.fn(), json: vi.fn() };
  res.status = vi.fn(() => res);
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url: '/driver/assignments/x/complete' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, res: res as MockRes };
}

function bodyOf(res: MockRes): Record<string, unknown> {
  const calls = res.json.mock.calls;
  const first = calls[0];
  if (first === undefined) throw new Error('json never called');
  return first[0] as Record<string, unknown>;
}

describe('ProblemDetailsExceptionFilter extensions passthrough', () => {
  beforeEach(() => { mockCaptureException.mockClear(); });

  it('spreads an explicit extensions object into the envelope (the 409 FSM seam)', () => {
    const { host, res } = makeHost();
    new ProblemDetailsExceptionFilter().catch(new HttpException({
      message: 'Trang thai chuyen da thay doi.',
      code: 'INVALID_STATE_TRANSITION',
      extensions: { currentState: 'planned', allowedActions: ['dispatched', 'cancelled'] },
    }, 409), host);
    const body = bodyOf(res);
    expect(body['status']).toBe(409);
    expect(body['code']).toBe('INVALID_STATE_TRANSITION');
    expect(body['currentState']).toBe('planned');
    expect(body['allowedActions']).toEqual(['dispatched', 'cancelled']);
    const problem = parseProblemDetails(body);
    expect(problem === null).toBe(false);
    expect(parseInvalidStateTransitionExtensions(body))
      .toEqual({ currentState: 'planned', allowedActions: ['dispatched', 'cancelled'] });
  });

  it('shields reserved envelope members from extension overwrite', () => {
    const { host, res } = makeHost();
    new ProblemDetailsExceptionFilter().catch(new HttpException({
      message: 'legit detail',
      code: 'INVALID_STATE_TRANSITION',
      extensions: {
        status: 999, detail: 'hacked', title: 'hacked', instance: 'hacked',
        code: 'HACKED', type: 'hacked', committed: 2,
      },
    }, 409), host);
    const body = bodyOf(res);
    expect(body['status']).toBe(409);
    expect(body['detail']).toBe('legit detail');
    expect(body['title']).toBe('Conflict');
    expect(body['instance']).toBe('/driver/assignments/x/complete');
    expect(body['code']).toBe('INVALID_STATE_TRANSITION');
    expect(body['type']).toBeUndefined();
    expect(body['committed']).toBe(2);
  });

  it('ignores a non-object extensions member', () => {
    const { host, res } = makeHost();
    new ProblemDetailsExceptionFilter().catch(new HttpException({
      message: 'x', extensions: 'not-an-object',
    }, 400), host);
    const body = bodyOf(res);
    expect(body['extensions']).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(['code', 'detail', 'instance', 'status', 'title']);
  });

  it('adds nothing when extensions is absent (existing envelopes byte-stable)', () => {
    const { host, res } = makeHost();
    new ProblemDetailsExceptionFilter().catch(new HttpException({ message: 'plain' }, 400), host);
    expect(Object.keys(bodyOf(res)).sort()).toEqual(['code', 'detail', 'instance', 'status', 'title']);
  });
});
