// apps/driver-app/test/api-error.test.ts
// RED-first (Phase 3.1 of the error-presentation arc): ApiError is the typed
// error the driver-app HTTP clients throw instead of bare Error. Root cause
// being fixed: DeliveryLifecycleClient.post() threw
// new Error(POST <url> HTTP <status> <statusText>) WITHOUT reading the
// response body, so (a) the RFC 9457 envelope the api now emits was discarded
// and (b) the raw URL + status line leaked into the on-screen banner (the
// field driver''s screenshot). ApiError extends Error (every existing
// err instanceof Error guard and the useMutation<_, Error, _> generic keep
// working), carries the parsed ProblemDetails envelope (null when the body is
// not an envelope), exposes code for the presenter, and its message NEVER
// contains a URL. Written before src/errors/api-error.ts exists -> fails at
// import resolution until the module lands.
import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/errors/api-error.js';

const ENVELOPE = {
  title: 'Conflict',
  status: 409,
  detail: 'Cannot complete a run that has not been started.',
  instance: '/driver/assignments/8269d97f/complete',
  code: 'INVALID_STATE_TRANSITION',
};

describe('driver-app ApiError', () => {
  it('is an Error subclass carrying the HTTP status', () => {
    const err = ApiError.fromBody(409, ENVELOPE);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ApiError).toBe(true);
    expect(err.status).toBe(409);
    expect(err.name).toBe('ApiError');
  });

  it('parses a problem-details body and exposes the code', () => {
    const err = ApiError.fromBody(409, ENVELOPE);
    expect(err.problem).not.toBeNull();
    expect(err.code).toBe('INVALID_STATE_TRANSITION');
    expect(err.problem?.detail).toBe('Cannot complete a run that has not been started.');
  });

  it('degrades safely when the body is not an envelope', () => {
    const legacy = ApiError.fromBody(400, { error: 'Bad Request', message: 'nope' });
    expect(legacy.problem).toBeNull();
    expect(legacy.code).toBeUndefined();
    const text = ApiError.fromBody(502, 'Bad Gateway');
    expect(text.problem).toBeNull();
    const empty = ApiError.fromBody(500, undefined);
    expect(empty.problem).toBeNull();
  });

  it('uses the envelope detail as its message when present', () => {
    const err = ApiError.fromBody(409, ENVELOPE);
    expect(err.message).toBe('Cannot complete a run that has not been started.');
  });

  it('falls back to a URL-free generic message without an envelope', () => {
    const err = ApiError.fromBody(400, { anything: true });
    expect(err.message).toBe('HTTP 400');
    expect(err.message.includes('http')).toBe(false);
    expect(err.message.includes('/driver/')).toBe(false);
  });

  it('keeps unknown future codes as plain strings (forward-compat)', () => {
    const err = ApiError.fromBody(422, { status: 422, code: 'A_CODE_FROM_THE_FUTURE' });
    expect(err.problem).not.toBeNull();
    expect(err.code).toBe('A_CODE_FROM_THE_FUTURE');
  });
});
