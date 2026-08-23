// apps/api/test/problem-details-exception.filter.test.ts
// RED-first (Phase 2 of the error-presentation arc): the api-wide catch-all
// exception filter that EMITS the RFC 9457 problem-details envelope defined in
// @fleet/sync-protocol. Registration plan (main.ts, GREEN step): the catch-all
// is registered FIRST and ZodExceptionFilter LAST -- Nest checks filters in
// reverse registration order, so ZodError keeps its existing 400 shape (zero
// regression on the validation contract) and everything else lands here.
// Behavior pinned by these tests:
//   - HttpException -> problem+json with status/title/detail/instance; a
//     machine-readable code EXTENSION defaulted from status (400
//     VALIDATION_FAILED, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND,
//     5xx INTERNAL) and overridable by an explicit code on the exception
//     response object (how the forgiving-FSM arc will ship
//     INVALID_STATE_TRANSITION on 409).
//   - Nest array messages (message: string[]) join into one detail.
//   - Unknown exceptions -> generic 500, fixed detail, ZERO internals leaked,
//     reported to Sentry; HttpExceptions are flow control, never reported.
//   - Content-Type: application/problem+json on every path; every body
//     round-trips through parseProblemDetails (contract conformance).
// Written before src/common/problem-details-exception.filter.ts exists ->
// fails at import resolution until the filter lands.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { parseProblemDetails, PROBLEM_DETAILS_CONTENT_TYPE } from '@fleet/sync-protocol';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nestjs', () => ({ captureException: mockCaptureException }));

import { ProblemDetailsExceptionFilter } from '../src/common/problem-details-exception.filter.js';

interface MockRes {
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}
function makeRes(): MockRes {
  const res: Partial<MockRes> = {
    setHeader: vi.fn(),
    json: vi.fn(),
  };
  res.status = vi.fn().mockReturnValue(res);
  return res as MockRes;
}
function makeHost(res: MockRes, url: string): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
}
function bodyOf(res: MockRes): Record<string, unknown> {
  expect(res.json).toHaveBeenCalledTimes(1);
  const first = res.json.mock.calls[0];
  if (first === undefined) throw new Error('res.json was not called');
  return first[0] as Record<string, unknown>;
}

describe('@fleet/api ProblemDetailsExceptionFilter', () => {
  beforeEach(() => {
    mockCaptureException.mockClear();
  });

  it('maps an HttpException carrying an explicit code (409 state transition)', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const res = makeRes();
    const ex = new HttpException(
      {
        message: 'Cannot complete a run that has not been started.',
        code: 'INVALID_STATE_TRANSITION',
      },
      409,
    );
    filter.catch(ex, makeHost(res, '/driver/assignments/8269d97f/complete'));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', PROBLEM_DETAILS_CONTENT_TYPE);
    const body = bodyOf(res);
    expect(body['status']).toBe(409);
    expect(body['code']).toBe('INVALID_STATE_TRANSITION');
    expect(body['title']).toBe('Conflict');
    expect(body['detail']).toBe('Cannot complete a run that has not been started.');
    expect(body['instance']).toBe('/driver/assignments/8269d97f/complete');
  });

  it('defaults the code from status for a plain HttpException', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const res = makeRes();
    filter.catch(new HttpException('Order not found', 404), makeHost(res, '/orders/9'));
    const body = bodyOf(res);
    expect(body['status']).toBe(404);
    expect(body['code']).toBe('NOT_FOUND');
    expect(body['title']).toBe('Not Found');
    expect(body['detail']).toBe('Order not found');
  });

  it('defaults 400 to VALIDATION_FAILED and joins Nest array messages', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const res = makeRes();
    const ex = new HttpException(
      { statusCode: 400, message: ['plate is required', 'driver is required'] },
      400,
    );
    filter.catch(ex, makeHost(res, '/orders'));
    const body = bodyOf(res);
    expect(body['code']).toBe('VALIDATION_FAILED');
    expect(body['detail']).toBe('plate is required; driver is required');
  });

  it('converts unknown exceptions to a generic 500 leaking zero internals', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const res = makeRes();
    filter.catch(new Error('pg password hunter2 at 10.0.0.7'), makeHost(res, '/sync'));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', PROBLEM_DETAILS_CONTENT_TYPE);
    const body = bodyOf(res);
    expect(body['status']).toBe(500);
    expect(body['code']).toBe('INTERNAL');
    expect(body['title']).toBe('Internal Server Error');
    expect(body['detail']).toBe('An unexpected error occurred.');
    const flat = JSON.stringify(body);
    expect(flat.includes('hunter2')).toBe(false);
    expect(flat.includes('10.0.0.7')).toBe(false);
  });

  it('reports unknown exceptions to Sentry but never HttpExceptions', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const boom = new Error('boom');
    filter.catch(boom, makeHost(makeRes(), '/a'));
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(boom);
    filter.catch(new HttpException('nope', 403), makeHost(makeRes(), '/b'));
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('emits bodies that round-trip through the shared contract on both paths', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const resA = makeRes();
    filter.catch(new HttpException('no', 401), makeHost(resA, '/x'));
    const resB = makeRes();
    filter.catch('not-even-an-error', makeHost(resB, '/y'));
    const a = parseProblemDetails(bodyOf(resA));
    const b = parseProblemDetails(bodyOf(resB));
    expect(a).not.toBeNull();
    expect(a?.code).toBe('UNAUTHORIZED');
    expect(b).not.toBeNull();
    expect(b?.status).toBe(500);
    expect(b?.code).toBe('INTERNAL');
  });
  it('falls back to generic 5xx title and INTERNAL code for unmapped 5xx statuses', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const res = makeRes();
    filter.catch(new HttpException('upstream down', 503), makeHost(res, '/erp'));
    const body = bodyOf(res);
    expect(body['status']).toBe(503);
    expect(body['title']).toBe('Internal Server Error');
    expect(body['code']).toBe('INTERNAL');
    expect(body['detail']).toBe('upstream down');
  });

  it('omits the code member entirely for an unmapped 4xx status', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const res = makeRes();
    filter.catch(new HttpException('teapot', 418), makeHost(res, '/coffee'));
    const body = bodyOf(res);
    expect(body['status']).toBe(418);
    expect(body['title']).toBe('Error');
    expect('code' in body).toBe(false);
    expect(body['detail']).toBe('teapot');
  });

  it('falls back to the exception message when an object response has no usable message', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const res = makeRes();
    filter.catch(new HttpException({ statusCode: 400 }, 400), makeHost(res, '/x'));
    const body = bodyOf(res);
    expect(typeof body['detail']).toBe('string');
    expect((body['detail'] as string).length).toBeGreaterThan(0);
  });

  it('handles a non-string non-object exception response via the exception message', () => {
    const filter = new ProblemDetailsExceptionFilter();
    const res = makeRes();
    const ex = new HttpException(42 as unknown as Record<string, unknown>, 400);
    filter.catch(ex, makeHost(res, '/n'));
    const body = bodyOf(res);
    expect(body['status']).toBe(400);
    expect(typeof body['detail']).toBe('string');
  });
});
