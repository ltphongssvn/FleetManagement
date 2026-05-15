// apps/api/test/passkey-registration-policy.test.ts
// RED: Pure policy decides whether a driver may register a new passkey credential.
// No I/O, no crypto here — only the decision tree:
//   - driver must exist and be active
//   - driver must have a bound operatorId
//   - credentialId must not already be registered to ANY driver (global uniqueness per WebAuthn spec)
//   - per-driver passkey limit (Apple/Google guidance: cap at 10 credentials per user)
import { describe, it, expect } from 'vitest';
import {
  decidePasskeyRegistrationOutcome,
  type PasskeyRegistrationCandidate,
  type PasskeyRegistrationOutcome,
} from '../src/auth/passkey-registration-policy.js';

const ACTIVE_DRIVER: PasskeyRegistrationCandidate = {
  driverId: '11111111-1111-1111-1111-111111111111',
  companyId: '22222222-2222-2222-2222-222222222222',
  businessUnitId: '33333333-3333-3333-3333-333333333333',
  depotId: '44444444-4444-4444-4444-444444444444',
  legalEntityId: '55555555-5555-5555-5555-555555555555',
  operatorId: '66666666-6666-6666-6666-666666666666',
  active: true,
  existingCredentialCount: 0,
};

describe('decidePasskeyRegistrationOutcome', () => {
  it('returns not-found when candidate is null', () => {
    const r: PasskeyRegistrationOutcome = decidePasskeyRegistrationOutcome(null, false, 10);
    expect(r.kind).toBe('not-found');
  });

  it('returns disabled when driver inactive', () => {
    const r = decidePasskeyRegistrationOutcome({ ...ACTIVE_DRIVER, active: false }, false, 10);
    expect(r.kind).toBe('disabled');
  });

  it('returns missing-operator when operatorId is null', () => {
    const r = decidePasskeyRegistrationOutcome({ ...ACTIVE_DRIVER, operatorId: null }, false, 10);
    expect(r.kind).toBe('missing-operator');
  });

  it('returns credential-collision when credentialId already exists globally', () => {
    const r = decidePasskeyRegistrationOutcome(ACTIVE_DRIVER, true, 10);
    expect(r.kind).toBe('credential-collision');
  });

  it('returns limit-exceeded when driver has >= max passkeys', () => {
    const r = decidePasskeyRegistrationOutcome({ ...ACTIVE_DRIVER, existingCredentialCount: 10 }, false, 10);
    expect(r.kind).toBe('limit-exceeded');
  });

  it('returns ok with binding when all checks pass', () => {
    const r = decidePasskeyRegistrationOutcome(ACTIVE_DRIVER, false, 10);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.binding).toEqual({
      driverId: ACTIVE_DRIVER.driverId,
      operatorId: ACTIVE_DRIVER.operatorId,
      companyId: ACTIVE_DRIVER.companyId,
      businessUnitId: ACTIVE_DRIVER.businessUnitId,
      depotId: ACTIVE_DRIVER.depotId,
      legalEntityId: ACTIVE_DRIVER.legalEntityId,
    });
  });

  it('treats existingCredentialCount = max - 1 as still allowed', () => {
    const r = decidePasskeyRegistrationOutcome({ ...ACTIVE_DRIVER, existingCredentialCount: 9 }, false, 10);
    expect(r.kind).toBe('ok');
  });

  it('checks collision before limit (collision is hard rejection)', () => {
    const r = decidePasskeyRegistrationOutcome({ ...ACTIVE_DRIVER, existingCredentialCount: 10 }, true, 10);
    expect(r.kind).toBe('credential-collision');
  });

  it('checks disabled before missing-operator', () => {
    const r = decidePasskeyRegistrationOutcome({ ...ACTIVE_DRIVER, active: false, operatorId: null }, false, 10);
    expect(r.kind).toBe('disabled');
  });
});
