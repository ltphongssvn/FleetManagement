// apps/api/test/owner-role-policy-ssot.test.ts
// The api must not DECLARE the owner role name -- it must consume the one
// @fleet/domain owns.
//
// ROOT CAUSE THIS CLOSES. owner-role-policy.ts declared
//   export const FLEET_OWNER_ROLE = 'fleet-owner' as const;
// That is correct while exactly one app needs the value and fatal the moment a
// second does: ops-web cannot import from apps/api, so the accounting-gate work
// had only two options, both wrong -- copy the literal, giving the SSOT two
// sources that drift apart silently, or cross an app boundary and make the
// dependency graph meaningless.
//
// WHY THE SOURCE CHECK CARRIES THE WEIGHT, corrected by its own RED run. The
// first draft leaned on toBe(DOMAIN_OWNER_ROLE), reasoning that a copy is not
// the same export. That is true for objects and FALSE for primitives: two
// independent 'fleet-owner' literals are ===, so the identity assertion passed
// while the duplicate declaration was still sitting in the source. Only 1 of 8
// cases went red, and it was the source check.
//
// So the value assertions below document the CONTRACT (the name Keycloak
// issues, membership in the vocabulary) and the source check is what actually
// enforces SINGLE DECLARATION. A grep-shaped assertion is crude, but the
// alternative -- trusting that nobody re-adds the line -- is exactly how the
// constant came to be duplicated in the first place.
//
// BEHAVIOUR IS UNCHANGED BY DESIGN. owner-role-policy.test.ts and
// owner-role.guard.test.ts are untouched and must stay green: this is a
// relocation, not a redesign. A refactor that needs its own tests rewritten to
// pass has changed behaviour and is no longer a refactor.
import { describe, expect, it } from 'vitest';
import { FLEET_OWNER_ROLE as DOMAIN_OWNER_ROLE, FLEET_ROLES } from '@fleet/domain';
import {
  FLEET_OWNER_ROLE as API_OWNER_ROLE,
  decideOwnerAccess,
} from '../src/owner/owner-role-policy.js';

describe('@fleet/api owner role is the @fleet/domain SSOT', () => {
  it('agrees with the domain SSOT (necessary, not sufficient -- see header)', () => {
    expect(API_OWNER_ROLE).toBe(DOMAIN_OWNER_ROLE);
  });

  it('carries the value Keycloak issues', () => {
    expect(API_OWNER_ROLE).toBe('fleet-owner');
  });

  it('is a member of the domain role vocabulary', () => {
    expect(FLEET_ROLES).toContain(API_OWNER_ROLE);
  });

  it('does not re-declare the literal in this package source', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../src/owner/owner-role-policy.ts', import.meta.url),
      'utf-8',
    );
    // The policy may IMPORT or RE-EXPORT the name; it must not assign it a
    // string literal. A grep-shaped assertion is crude, but the alternative --
    // trusting that nobody re-adds the line -- is how the constant ended up
    // duplicated in the first place.
    expect(src).not.toMatch(/FLEET_OWNER_ROLE\s*=\s*['"]fleet-owner['"]/);
  });
});

describe('decideOwnerAccess behaviour is unchanged by the relocation', () => {
  it('grants on the exact role', () => {
    expect(decideOwnerAccess([DOMAIN_OWNER_ROLE])).toEqual({ outcome: 'granted' });
  });

  it('grants among unrelated realm roles', () => {
    expect(decideOwnerAccess(['offline_access', DOMAIN_OWNER_ROLE, 'uma_authorization'])).toEqual({
      outcome: 'granted',
    });
  });

  it('denies a lookalike -- no prefix, no substring', () => {
    expect(decideOwnerAccess(['fleet-owner-readonly'])).toEqual({ outcome: 'denied' });
    expect(decideOwnerAccess(['not-fleet-owner'])).toEqual({ outcome: 'denied' });
  });

  it('denies on empty and on undefined', () => {
    expect(decideOwnerAccess([])).toEqual({ outcome: 'denied' });
    expect(decideOwnerAccess(undefined)).toEqual({ outcome: 'denied' });
  });
});
