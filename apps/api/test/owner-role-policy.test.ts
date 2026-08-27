// apps/api/test/owner-role-policy.test.ts
// RED: pure owner-authorization policy. Given the roles carried on a verified
// identity, decide whether the owner dashboard may be read. Keeps the HTTP
// guard a thin adapter (mirrors step-up-policy vs step-up.guard split).
import { describe, it, expect } from 'vitest';
import { FLEET_OWNER_ROLE, decideOwnerAccess } from '../src/owner/owner-role-policy.js';

describe('@fleet/api - decideOwnerAccess', () => {
  it('grants when the fleet-owner role is present', () => {
    expect(decideOwnerAccess([FLEET_OWNER_ROLE])).toEqual({ outcome: 'granted' });
  });

  it('grants when fleet-owner is among several roles', () => {
    expect(decideOwnerAccess(['offline_access', FLEET_OWNER_ROLE, 'uma_authorization'])).toEqual({
      outcome: 'granted',
    });
  });

  it('denies when the role is absent', () => {
    expect(decideOwnerAccess(['dispatcher'])).toEqual({ outcome: 'denied' });
  });

  it('denies on an empty role list', () => {
    expect(decideOwnerAccess([])).toEqual({ outcome: 'denied' });
  });

  it('denies when roles are undefined (token carried none)', () => {
    expect(decideOwnerAccess(undefined)).toEqual({ outcome: 'denied' });
  });

  it('does not treat a lookalike role as owner', () => {
    expect(decideOwnerAccess(['fleet-owner-readonly', 'not-fleet-owner'])).toEqual({
      outcome: 'denied',
    });
  });
});
