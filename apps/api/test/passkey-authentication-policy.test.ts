// apps/api/test/passkey-authentication-policy.test.ts
// RED: Pure policy for verifying a passkey authentication attempt.
// No crypto — that's @simplewebauthn/server's job. This policy decides post-verification:
//   - credential must exist and belong to an active driver with bound operatorId
//   - sign_count MUST be strictly greater than stored counter (WebAuthn spec L3 §6.1.3
//     step 21: equal or lower indicates cloned authenticator — reject)
//   - exception: sign_count = 0 stored AND sign_count = 0 presented is allowed
//     (some authenticators, notably Apple Passkeys, never increment)
// Returns the same LoginClaims shape as password login so downstream JWT signing is reused.
import { describe, it, expect } from 'vitest';
import {
  decidePasskeyAuthenticationOutcome,
  type PasskeyAuthenticationCandidate,
  type PasskeyAuthenticationOutcome,
} from '../src/auth/passkey-authentication-policy.js';

const VALID: PasskeyAuthenticationCandidate = {
  driverId: '11111111-1111-1111-1111-111111111111',
  companyId: '22222222-2222-2222-2222-222222222222',
  businessUnitId: '33333333-3333-3333-3333-333333333333',
  depotId: '44444444-4444-4444-4444-444444444444',
  legalEntityId: '55555555-5555-5555-5555-555555555555',
  operatorId: '66666666-6666-6666-6666-666666666666',
  active: true,
  storedSignCount: 5,
};

describe('decidePasskeyAuthenticationOutcome', () => {
  it('returns credential-not-found when candidate is null', () => {
    const r: PasskeyAuthenticationOutcome = decidePasskeyAuthenticationOutcome(null, 6);
    expect(r.kind).toBe('credential-not-found');
  });

  it('returns disabled when driver inactive', () => {
    const r = decidePasskeyAuthenticationOutcome({ ...VALID, active: false }, 6);
    expect(r.kind).toBe('disabled');
  });

  it('returns missing-operator when operatorId is null', () => {
    const r = decidePasskeyAuthenticationOutcome({ ...VALID, operatorId: null }, 6);
    expect(r.kind).toBe('missing-operator');
  });

  it('returns cloned-authenticator when presented sign_count <= stored sign_count (and stored > 0)', () => {
    const equal = decidePasskeyAuthenticationOutcome(VALID, 5);
    expect(equal.kind).toBe('cloned-authenticator');
    const lower = decidePasskeyAuthenticationOutcome(VALID, 4);
    expect(lower.kind).toBe('cloned-authenticator');
  });

  it('allows sign_count = 0 when stored = 0 (non-incrementing authenticator, e.g. Apple Passkey)', () => {
    const r = decidePasskeyAuthenticationOutcome({ ...VALID, storedSignCount: 0 }, 0);
    expect(r.kind).toBe('ok');
  });

  it('rejects sign_count = 0 when stored > 0 (counter reset = cloned)', () => {
    const r = decidePasskeyAuthenticationOutcome(VALID, 0);
    expect(r.kind).toBe('cloned-authenticator');
  });

  it('returns ok with claims when sign_count strictly increases', () => {
    const r = decidePasskeyAuthenticationOutcome(VALID, 6);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.claims).toEqual({
      sub: VALID.operatorId,
      companyId: VALID.companyId,
      businessUnitId: VALID.businessUnitId,
      depotId: VALID.depotId,
      legalEntityId: VALID.legalEntityId,
      driverId: VALID.driverId,
    });
    expect(r.newSignCount).toBe(6);
  });

  it('checks disabled before clone (disabled is hard rejection)', () => {
    const r = decidePasskeyAuthenticationOutcome({ ...VALID, active: false }, 4);
    expect(r.kind).toBe('disabled');
  });

  it('checks missing-operator before clone', () => {
    const r = decidePasskeyAuthenticationOutcome({ ...VALID, operatorId: null }, 4);
    expect(r.kind).toBe('missing-operator');
  });
});
