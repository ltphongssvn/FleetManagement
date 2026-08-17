// packages/domain/test/fleet-role.barrel-export.test.ts
// The FLEET ROLE SSOT must be reachable from the @fleet/domain package ROOT,
// because every consumer imports from the barrel, never from a deep src path.
// Without this the SSOT exists but is unusable across the package boundary --
// which is exactly how a parallel re-declaration gets introduced downstream.
//
// THAT IS NOT HYPOTHETICAL HERE. This whole module exists because
// FLEET_OWNER_ROLE was declared inside apps/api and ops-web could not legally
// import it, leaving a second consumer the choice of duplicating the literal or
// crossing an app boundary. Moving the constant into packages/ fixes nothing if
// the barrel does not carry it: the reachability is the fix, not the file.
//
// Mirrors phieu-can-format.barrel-export.test.ts, which states the same
// contract for the phieu-can vocabulary.
import { describe, expect, it } from 'vitest';
import * as domain from '../src/index.js';

describe('@fleet/domain barrel: fleet role SSOT', () => {
  it('re-exports the role vocabulary', () => {
    expect(domain.FLEET_ROLES).toEqual(['fleet-owner']);
  });

  it('re-exports the owner role constant', () => {
    expect(domain.FLEET_OWNER_ROLE).toBe('fleet-owner');
  });

  it('re-exports the role schema, which parses a known role', () => {
    expect(domain.FleetRoleSchema.parse('fleet-owner')).toBe('fleet-owner');
  });

  it('re-exports a schema that still REJECTS a lookalike through the barrel', () => {
    expect(domain.FleetRoleSchema.safeParse('fleet-owner-readonly').success).toBe(false);
  });

  it('re-exports the exact-match membership helper', () => {
    expect(domain.hasFleetRole(['offline_access', 'fleet-owner'], domain.FLEET_OWNER_ROLE))
      .toBe(true);
  });

  it('re-exports a helper that still denies a lookalike through the barrel', () => {
    expect(domain.hasFleetRole(['fleet-owner-readonly'], domain.FLEET_OWNER_ROLE))
      .toBe(false);
  });

  it('re-exports a frozen vocabulary -- a consumer cannot grant itself a role', () => {
    // Asserts DEFINEDNESS first, and that ordering was earned. The original
    // assertion was Object.isFrozen alone -- which returns TRUE for undefined,
    // so it passed happily when the barrel export was deleted. Found by
    // mutation-testing this very file: removing the role block from
    // src/index.ts turned six of seven cases red and left this one green.
    // A guard that survives the mutation it exists to catch is decoration.
    expect(domain.FLEET_ROLES).toBeDefined();
    expect(Array.isArray(domain.FLEET_ROLES)).toBe(true);
    expect(Object.isFrozen(domain.FLEET_ROLES)).toBe(true);
  });
});
