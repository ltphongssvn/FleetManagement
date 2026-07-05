// packages/sync-protocol/test/problem-details-contract.test.ts
// RED-first: the shared RFC 9457 problem-details wire contract for ALL Fleet
// error responses. Today every client renders raw Error.message (the driver
// app showed a raw POST url + HTTP 400 line to a driver on the field); the
// api has no envelope beyond the ad-hoc ZodExceptionFilter 400 shape. This
// contract is the single source of truth both for the api global filter that
// EMITS application/problem+json and for the driver-app/ops-web presenters
// that CONSUME it and map machine-readable codes to friendly Vietnamese copy.
// Design (2026, RFC 9457): base members type/title/status/detail/instance;
// machine handling keys off the code EXTENSION member, never off human text;
// unknown extension members must survive parsing (looseObject) so the coming
// forgiving-FSM arc can add currentState/allowedActions with no schema
// change; code is a loose string at the wire boundary (an older app must not
// nuke a whole envelope over a newer unknown code) while FleetErrorCodeSchema
// is the strict producer/mapper union, mirroring the login-error.ts house
// pattern. Written before packages/sync-protocol/src/problem-details-contract.ts
// exists -> fails at import resolution until source + barrel export land.
import { describe, it, expect } from 'vitest';
import {
  FLEET_ERROR_CODES,
  FleetErrorCodeSchema,
  ProblemDetailsSchema,
  parseProblemDetails,
  PROBLEM_DETAILS_CONTENT_TYPE,
  type FleetErrorCode,
  type ProblemDetails,
} from '../src/problem-details-contract.js';

const FULL = {
  type: 'https://fleet.vominhchau.com/problems/invalid-state-transition',
  title: 'Invalid state transition',
  status: 409,
  detail: 'Cannot complete a run that has not been started.',
  instance: '/driver/assignments/8269d97f/complete',
  code: 'INVALID_STATE_TRANSITION',
};

describe('@fleet/sync-protocol problem-details contract', () => {
  it('parses a full RFC 9457 envelope with the code extension', () => {
    const pd = parseProblemDetails(FULL);
    expect(pd).not.toBeNull();
    expect(pd?.status).toBe(409);
    expect(pd?.code).toBe('INVALID_STATE_TRANSITION');
    expect(pd?.detail).toBe('Cannot complete a run that has not been started.');
  });

  it('requires only status: a minimal envelope parses', () => {
    const pd = parseProblemDetails({ status: 500 });
    expect(pd).not.toBeNull();
    expect(pd?.status).toBe(500);
    expect(pd?.code).toBeUndefined();
  });

  it('preserves unknown extension members (forward-compat for the FSM arc)', () => {
    const pd = parseProblemDetails({
      ...FULL,
      currentState: 'dispatched',
      allowedActions: ['start'],
    });
    expect(pd).not.toBeNull();
    const rec = pd as unknown as Record<string, unknown>;
    expect(rec['currentState']).toBe('dispatched');
    expect(rec['allowedActions']).toEqual(['start']);
  });

  it('keeps an unknown code as a plain string instead of rejecting the envelope', () => {
    const pd = parseProblemDetails({ ...FULL, code: 'A_CODE_FROM_THE_FUTURE' });
    expect(pd).not.toBeNull();
    expect(pd?.code).toBe('A_CODE_FROM_THE_FUTURE');
  });

  it('returns null for a non-integer or out-of-range status', () => {
    expect(parseProblemDetails({ ...FULL, status: 99 })).toBeNull();
    expect(parseProblemDetails({ ...FULL, status: 600 })).toBeNull();
    expect(parseProblemDetails({ ...FULL, status: 409.5 })).toBeNull();
    expect(parseProblemDetails({ ...FULL, status: 'oops' })).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(parseProblemDetails(null)).toBeNull();
    expect(parseProblemDetails(undefined)).toBeNull();
    expect(parseProblemDetails('error')).toBeNull();
    expect(parseProblemDetails(42)).toBeNull();
  });

  it('exposes the RFC 9457 media type constant', () => {
    expect(PROBLEM_DETAILS_CONTENT_TYPE).toBe('application/problem+json');
  });

  it('anchors the code union for both arcs and rejects non-members strictly', () => {
    expect(FLEET_ERROR_CODES).toContain('VALIDATION_FAILED');
    expect(FLEET_ERROR_CODES).toContain('INVALID_STATE_TRANSITION');
    expect(FLEET_ERROR_CODES).toContain('INTERNAL');
    expect(FleetErrorCodeSchema.safeParse('INVALID_STATE_TRANSITION').success).toBe(true);
    expect(FleetErrorCodeSchema.safeParse('A_CODE_FROM_THE_FUTURE').success).toBe(false);
  });

  it('schema parse and the exported types line up', () => {
    const parsed: ProblemDetails = ProblemDetailsSchema.parse(FULL);
    const c: FleetErrorCode = 'NOT_FOUND';
    expect(typeof parsed.status).toBe('number');
    expect(FLEET_ERROR_CODES).toContain(c);
  });
});
