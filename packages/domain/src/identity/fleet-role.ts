// packages/domain/src/identity/fleet-role.ts
// SSOT for FLEET REALM ROLES -- the role names Keycloak puts on an access token
// and the API authorizes against. Sole authoritative definition, mirroring the
// charter operator-context.ts states for tenancy: consumed by apps/api, ops-web
// and any future surface, and declared in exactly one place.
//
// ROOT CAUSE THIS CLOSES. FLEET_OWNER_ROLE lived inside
// apps/api/src/owner/owner-role-policy.ts. That is correct while exactly one app
// needs it and fatal the moment a second one does: ops-web cannot import from
// apps/api, because applications are deployable systems and must not reach into
// one another. A second consumer therefore had only two options, both wrong --
// duplicate the literal, so the SSOT quietly has two sources that drift; or
// cross the app boundary, so the dependency graph stops meaning anything.
//
// Found while designing the accounting-department gate, which needs the role
// name in BOTH the API guard and the ops-web session read. The constant had to
// move before that feature could be written honestly. The 2026 monorepo rule is
// explicit: shared vocabulary lives in packages/, apps depend on packages, and
// apps never depend on apps.
//
// WHY A ZOD SCHEMA RATHER THAN A BARE UNION. Roles arrive from OUTSIDE the trust
// boundary -- realm_access.roles on a JWT this codebase did not mint. A
// TypeScript union asserts a shape at compile time and proves nothing at runtime
// about a value the API never created. Schema-first exists precisely for this
// seam.
//
// EXACT MATCH ONLY. Inherited deliberately from decideOwnerAccess, which states
// it as "no prefix/substring - so a lookalike role name can never grant owner
// access". A prefix check would admit fleet-owner-readonly; a substring check
// would admit anything containing the name. Both are trivially mintable by
// whoever can create realm roles.
import { z } from 'zod';

/** Realm role granting owner-dashboard access. Value is the Keycloak role name
 *  and is load-bearing: changing it silently revokes access for every operator
 *  holding the old one, so it is a coordinated Keycloak + code change. */
export const FLEET_OWNER_ROLE = 'fleet-owner' as const;

/** Every realm role this system recognises. FROZEN: a consumer that could push
 *  onto this array could grant itself a role at runtime. New roles are added
 *  HERE and nowhere else -- that is the entire point of the module. */
export const FLEET_ROLES = Object.freeze([FLEET_OWNER_ROLE] as const);

export type FleetRole = (typeof FLEET_ROLES)[number];

/** Parses an untrusted claim value into a known role. Rejects lookalikes, case
 *  variants and padded strings, because z.enum matches literally -- no trim, no
 *  case folding, no coercion. Those absences are the security property. */
export const FleetRoleSchema = z.enum(FLEET_ROLES);

/** EXACT membership test over a token's realm roles.
 *
 *  Takes readonly string[] | undefined rather than FleetRole[] on purpose: the
 *  input is a raw JWT claim, so it carries roles this system has never heard of
 *  (offline_access, uma_authorization) alongside ours. Narrowing the parameter
 *  type would force callers to pre-filter, and a caller that pre-filters wrongly
 *  is exactly the bug this centralises away.
 *
 *  undefined denies rather than throwing: an absent claim is a legitimate token
 *  shape (a driver's self-issued token has no realm_access), and an
 *  authorization helper must answer no, not crash the request pipeline. */
export function hasFleetRole(roles: readonly string[] | undefined, required: FleetRole): boolean {
  return roles?.includes(required) === true;
}
