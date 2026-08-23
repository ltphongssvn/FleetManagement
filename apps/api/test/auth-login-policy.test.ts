// apps/api/test/auth-login-policy.test.ts
// RED: pure function deciding login outcome from candidate + bcrypt verify result.
import { describe, it, expect } from 'vitest';
import { decideLoginOutcome, type LoginCandidate } from '../src/auth/auth-login-policy.js';

describe('decideLoginOutcome', () => {
  it('returns not-found when no candidate', () => {
    expect(decideLoginOutcome(null, false)).toEqual({ kind: 'not-found' });
  });
  it('returns invalid-password when candidate found but bcrypt mismatch', () => {
    const c: LoginCandidate = {
      driverId: 'd1',
      companyId: 'c1',
      businessUnitId: 'b1',
      depotId: 'd1',
      legalEntityId: 'l1',
      operatorId: 'op1',
      passwordHash: 'h',
      active: true,
    };
    expect(decideLoginOutcome(c, false)).toEqual({ kind: 'invalid-password' });
  });
  it('returns disabled when active is false', () => {
    const c: LoginCandidate = {
      driverId: 'd1',
      companyId: 'c1',
      businessUnitId: 'b1',
      depotId: 'd1',
      legalEntityId: 'l1',
      operatorId: 'op1',
      passwordHash: 'h',
      active: false,
    };
    expect(decideLoginOutcome(c, true)).toEqual({ kind: 'disabled' });
  });
  it('returns missing-operator when operatorId is null', () => {
    const c: LoginCandidate = {
      driverId: 'd1',
      companyId: 'c1',
      businessUnitId: 'b1',
      depotId: 'd1',
      legalEntityId: 'l1',
      operatorId: null,
      passwordHash: 'h',
      active: true,
    };
    expect(decideLoginOutcome(c, true)).toEqual({ kind: 'missing-operator' });
  });
  it('returns ok with claims when all checks pass', () => {
    const c: LoginCandidate = {
      driverId: 'd1',
      companyId: 'c1',
      businessUnitId: 'b1',
      depotId: 'dp1',
      legalEntityId: 'l1',
      operatorId: 'op1',
      passwordHash: 'h',
      active: true,
    };
    expect(decideLoginOutcome(c, true)).toEqual({
      kind: 'ok',
      claims: {
        sub: 'op1',
        companyId: 'c1',
        businessUnitId: 'b1',
        depotId: 'dp1',
        legalEntityId: 'l1',
        driverId: 'd1',
      },
    });
  });
});
