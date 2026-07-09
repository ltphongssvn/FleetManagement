// apps/api/test/refresh-rotation-policy.test.ts
// RED spec (driver-app-security arc, Phase 3.2a): pure rotation decision.
// Mirrors the auth-login-policy pattern: a pure function decides the outcome
// from a candidate row + clock; the service performs IO around it. Outcome
// order is security-critical: a revoked row is REUSE (family compromise
// signal, checked before expiry -- a stolen-then-expired token must still
// trigger family revocation), then expiry, then driver-active gating.
import { describe, expect, it } from 'vitest';
import {
  decideRotationOutcome,
  type RefreshCandidate,
} from '../src/auth/refresh-rotation-policy.js';

const NOW_MS = Date.parse('2026-07-06T12:00:00Z');
const LIVE: RefreshCandidate = {
  driverId: '3b241101-e2bb-4255-8caf-4136c566a962',
  companyId: '00000000-0000-0000-0000-000000000000',
  businessUnitId: '11111111-1111-1111-1111-111111111111',
  depotId: '22222222-2222-2222-2222-222222222222',
  legalEntityId: '33333333-3333-3333-3333-333333333333',
  operatorId: '9f8b8d64-0d2a-4a6b-9c37-5a2b6f1d3e4c',
  familyId: '44444444-4444-4444-4444-444444444444',
  expiresAt: new Date(NOW_MS + 86_400_000),
  revokedAt: null,
  driverActive: true,
};

describe('decideRotationOutcome', () => {
  it('returns not-found when no row matches the presented token hash', () => {
    expect(decideRotationOutcome(null, NOW_MS)).toEqual({ kind: 'not-found' });
  });

  it('returns reused with the familyId when the row is already revoked', () => {
    const out = decideRotationOutcome({ ...LIVE, revokedAt: new Date(NOW_MS - 1000) }, NOW_MS);
    expect(out).toEqual({ kind: 'reused', familyId: LIVE.familyId });
  });

  it('flags reuse even when the revoked token is also expired (reuse outranks expiry)', () => {
    const out = decideRotationOutcome(
      { ...LIVE, revokedAt: new Date(NOW_MS - 5000), expiresAt: new Date(NOW_MS - 1000) },
      NOW_MS,
    );
    expect(out.kind).toBe('reused');
  });

  it('returns expired when the live token is past expiresAt', () => {
    const out = decideRotationOutcome({ ...LIVE, expiresAt: new Date(NOW_MS - 1) }, NOW_MS);
    expect(out).toEqual({ kind: 'expired' });
  });

  it('treats expiresAt exactly equal to now as expired', () => {
    const out = decideRotationOutcome({ ...LIVE, expiresAt: new Date(NOW_MS) }, NOW_MS);
    expect(out).toEqual({ kind: 'expired' });
  });

  it('returns driver-disabled when the bound driver is inactive', () => {
    const out = decideRotationOutcome({ ...LIVE, driverActive: false }, NOW_MS);
    expect(out).toEqual({ kind: 'driver-disabled' });
  });

  it('returns ok with claims and familyId for a live token', () => {
    const out = decideRotationOutcome(LIVE, NOW_MS);
    expect(out).toEqual({
      kind: 'ok',
      familyId: LIVE.familyId,
      claims: {
        sub: LIVE.operatorId,
        companyId: LIVE.companyId,
        businessUnitId: LIVE.businessUnitId,
        depotId: LIVE.depotId,
        legalEntityId: LIVE.legalEntityId,
        driverId: LIVE.driverId,
      },
    });
  });

  it('claims.sub is the operatorId (token subject), matching the login policy', () => {
    const out = decideRotationOutcome(LIVE, NOW_MS);
    expect(out.kind === 'ok' && out.claims.sub === LIVE.operatorId).toBe(true);
  });
});
