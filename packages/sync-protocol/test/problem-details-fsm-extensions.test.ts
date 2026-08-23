// packages/sync-protocol/test/problem-details-fsm-extensions.test.ts
// RED-first (forgiving-FSM arc, U1): structured FSM rejection contract.
// The live P7 replay proved the defect: planned -> completed rejection ships
// as 400/VALIDATION_FAILED with an internal English diagnostic in detail and
// zero structured data. This contract adds:
//   - MANIFESTS_INCOMPLETE to the strict FLEET_ERROR_CODES union (adding a
//     member deliberately FORCES Vietnamese copy in both app presenters at
//     typecheck -- the exhaustive-Record mechanism working as designed);
//   - InvalidStateTransitionExtensionsSchema { currentState, allowedActions }
//     (allowedActions = allowed TARGET STATES from the FSM table; loose
//     string values per two-tier rule so future states never crash readers);
//   - ManifestsIncompleteExtensionsSchema { committed, required } for the
//     completion photo gate;
//   - parse helpers taking the FULL problem envelope (looseObject output of
//     parseProblemDetails preserves extension members) and returning the
//     typed extensions or null.
// Fails now: the exports do not exist (undefined.safeParse TypeErrors) and
// FLEET_ERROR_CODES lacks the new member.
import { describe, it, expect } from 'vitest';
import {
  FLEET_ERROR_CODES,
  InvalidStateTransitionExtensionsSchema,
  parseInvalidStateTransitionExtensions,
  ManifestsIncompleteExtensionsSchema,
  parseManifestsIncompleteExtensions,
  type InvalidStateTransitionExtensions,
} from '../src/problem-details-contract.js';

const ENVELOPE_IST = {
  title: 'Conflict',
  status: 409,
  detail: 'Trang thai chuyen da thay doi.',
  instance: '/driver/assignments/x/complete',
  code: 'INVALID_STATE_TRANSITION',
  currentState: 'planned',
  allowedActions: ['dispatched', 'cancelled'],
};

describe('FSM structured-error contract', () => {
  it('FLEET_ERROR_CODES pinned membership (12 members incl. device-binding + assignment-conflict)', () => {
    expect([...FLEET_ERROR_CODES].sort()).toEqual([
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

  it('parses invalid-state-transition extensions from a full envelope', () => {
    const ext = parseInvalidStateTransitionExtensions(ENVELOPE_IST);
    expect(ext).toEqual({ currentState: 'planned', allowedActions: ['dispatched', 'cancelled'] });
  });

  it('IST schema requires currentState and an array of non-empty action strings', () => {
    expect(InvalidStateTransitionExtensionsSchema.safeParse({ allowedActions: [] }).success).toBe(
      false,
    );
    expect(
      InvalidStateTransitionExtensionsSchema.safeParse({ currentState: '', allowedActions: [] })
        .success,
    ).toBe(false);
    expect(
      InvalidStateTransitionExtensionsSchema.safeParse({
        currentState: 'planned',
        allowedActions: 'dispatched',
      }).success,
    ).toBe(false);
    expect(
      InvalidStateTransitionExtensionsSchema.safeParse({
        currentState: 'planned',
        allowedActions: ['', 'x'],
      }).success,
    ).toBe(false);
  });

  it('IST parse returns null for envelopes without the extensions (legacy tolerance)', () => {
    expect(parseInvalidStateTransitionExtensions({ title: 'Conflict', status: 409 })).toBeNull();
    expect(parseInvalidStateTransitionExtensions('not an object')).toBeNull();
    expect(parseInvalidStateTransitionExtensions(undefined)).toBeNull();
  });

  it('IST strips envelope members and unknown keys (must-ignore both ways)', () => {
    const ext = parseInvalidStateTransitionExtensions({ ...ENVELOPE_IST, futureField: 42 });
    expect(ext !== null && 'title' in ext).toBe(false);
    expect(ext !== null && 'futureField' in ext).toBe(false);
  });

  it('parses manifests-incomplete extensions (non-negative ints) and rejects garbage', () => {
    expect(
      parseManifestsIncompleteExtensions({
        status: 409,
        code: 'MANIFESTS_INCOMPLETE',
        committed: 2,
        required: 4,
      }),
    ).toEqual({ committed: 2, required: 4 });
    expect(
      ManifestsIncompleteExtensionsSchema.safeParse({ committed: -1, required: 4 }).success,
    ).toBe(false);
    expect(
      ManifestsIncompleteExtensionsSchema.safeParse({ committed: 1.5, required: 4 }).success,
    ).toBe(false);
    expect(parseManifestsIncompleteExtensions({ status: 409 })).toBeNull();
  });

  it('derives the IST type via z.infer (compile-time SSOT proof)', () => {
    const ext: InvalidStateTransitionExtensions = {
      currentState: 'started',
      allowedActions: ['completed', 'cancelled'],
    };
    expect(ext.allowedActions).toHaveLength(2);
  });
});
