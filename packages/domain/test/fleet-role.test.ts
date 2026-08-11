// packages/domain/test/fleet-role.test.ts
// Contract for the FLEET ROLE vocabulary -- the realm-role names Keycloak puts
// on a token and the API authorizes against.
//
// ROOT CAUSE THIS CLOSES. FLEET_OWNER_ROLE was declared inside
// apps/api/src/owner/owner-role-policy.ts. That is fine while exactly one app
// needs it and fatal the moment a second one does: ops-web cannot import from
// apps/api -- applications are deployable systems and must not reach into each
// other -- so a second consumer has only two options, both wrong. Duplicate the
// literal, and the SSOT quietly has two sources. Or cross the app boundary, and
// the dependency graph stops meaning anything.
//
// This was discovered while designing the accounting-department gate, which
// needs the role name in BOTH the API guard and the ops-web session read. The
// constant had to move before that feature could be written honestly.
//
// operator-context.ts sets the precedent in this very package: "Shared tenancy
// context. Sole authoritative definition; consumed by apps/api, apps/driver-app,
// ops-web, and @fleet/test-fixtures." Role identity is the same species of
// cross-cutting vocabulary and belongs in the same place.
//
// WHY A ZOD SCHEMA AND NOT A BARE UNION. Roles arrive from OUTSIDE the trust
// boundary -- realm_access.roles on a JWT minted by Keycloak. A TypeScript union
// asserts a shape at compile time and proves nothing at runtime about a value
// the API did not create. Schema-first is the house rule precisely here.
//
// EXACT MATCH ONLY, inherited deliberately from decideOwnerAccess: "Exact string
// match only - no prefix/substring - so a lookalike role name can never grant
// owner access." A tenant that can self-assign role names could otherwise mint
// fleet-owner-readonly and pass a startsWith check.
import { describe, it, expect } from 'vitest';
import {
  FLEET_ROLES,
  FLEET_OWNER_ROLE,
  FleetRoleSchema,
  hasFleetRole,
  type FleetRole,
} from '../src/identity/fleet-role.js';

describe('FLEET_ROLES vocabulary', () => {
  it('is a frozen tuple -- the SSOT cannot be mutated by a consumer', () => {
    expect(Object.isFrozen(FLEET_ROLES)).toBe(true);
  });

  it('contains the owner role', () => {
    expect(FLEET_ROLES).toContain('fleet-owner');
  });

  it('names FLEET_OWNER_ROLE identically to the apps/api literal it replaces', () => {
    expect(FLEET_OWNER_ROLE).toBe('fleet-owner');
  });

  it('holds FLEET_OWNER_ROLE as a member, not merely a lookalike', () => {
    expect(FLEET_ROLES).toContain(FLEET_OWNER_ROLE);
  });

  it('has no duplicate entries', () => {
    expect(new Set(FLEET_ROLES).size).toBe(FLEET_ROLES.length);
  });

  it('uses the fleet- prefix for every role, so realm roles are recognisable', () => {
    for (const role of FLEET_ROLES) {
      expect(role.startsWith('fleet-')).toBe(true);
    }
  });
});

describe('FleetRoleSchema parses at the trust boundary', () => {
  it('accepts every declared role', () => {
    for (const role of FLEET_ROLES) {
      expect(FleetRoleSchema.parse(role)).toBe(role);
    }
  });

  it('REJECTS a lookalike that a prefix check would admit', () => {
    expect(FleetRoleSchema.safeParse('fleet-owner-readonly').success).toBe(false);
    expect(FleetRoleSchema.safeParse('not-fleet-owner').success).toBe(false);
  });

  it('rejects case variants -- realm roles are case-sensitive', () => {
    expect(FleetRoleSchema.safeParse('Fleet-Owner').success).toBe(false);
    expect(FleetRoleSchema.safeParse('FLEET-OWNER').success).toBe(false);
  });

  it('rejects whitespace-padded values rather than trimming them', () => {
    expect(FleetRoleSchema.safeParse(' fleet-owner').success).toBe(false);
    expect(FleetRoleSchema.safeParse('fleet-owner ').success).toBe(false);
  });

  it('rejects empty string, null and undefined', () => {
    expect(FleetRoleSchema.safeParse('').success).toBe(false);
    expect(FleetRoleSchema.safeParse(null).success).toBe(false);
    expect(FleetRoleSchema.safeParse(undefined).success).toBe(false);
  });

  it('rejects a non-string, which a raw JWT claim can certainly be', () => {
    expect(FleetRoleSchema.safeParse(42).success).toBe(false);
    expect(FleetRoleSchema.safeParse(['fleet-owner']).success).toBe(false);
  });
});

describe('hasFleetRole -- exact membership, never prefix', () => {
  it('grants when the exact role is present', () => {
    expect(hasFleetRole(['fleet-owner'], FLEET_OWNER_ROLE)).toBe(true);
  });

  it('grants when the role sits among unrelated realm roles', () => {
    const roles = ['offline_access', 'fleet-owner', 'uma_authorization'];
    expect(hasFleetRole(roles, FLEET_OWNER_ROLE)).toBe(true);
  });

  it('DENIES a lookalike -- the whole point of exact match', () => {
    expect(hasFleetRole(['fleet-owner-readonly'], FLEET_OWNER_ROLE)).toBe(false);
    expect(hasFleetRole(['xfleet-owner'], FLEET_OWNER_ROLE)).toBe(false);
  });

  it('denies on an empty list', () => {
    expect(hasFleetRole([], FLEET_OWNER_ROLE)).toBe(false);
  });

  it('denies on undefined -- an absent claim must never grant', () => {
    expect(hasFleetRole(undefined, FLEET_OWNER_ROLE)).toBe(false);
  });

  it('is unaffected by extra roles the API does not know about', () => {
    const roles = ['some-future-role', 'fleet-owner'];
    expect(hasFleetRole(roles, FLEET_OWNER_ROLE)).toBe(true);
  });
});

describe('type surface', () => {
  it('FleetRole is inhabited by the declared literals', () => {
    const owner: FleetRole = FLEET_OWNER_ROLE;
    expect(owner).toBe('fleet-owner');
  });
});
