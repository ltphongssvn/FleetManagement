// apps/api/src/owner/owner-role-policy.ts
// Pure owner-authorization policy. The fleet API is its own trust domain: it
// does not import Keycloak realm config, it authorizes on the roles carried in
// the already-verified token (realm_access.roles, surfaced onto
// VerifiedIdentity.roles). Exact string match only - no prefix/substring - so
// a lookalike role name can never grant owner access. Kept pure and Nest-free
// so it unit-tests without the HTTP pipeline (mirrors step-up-policy.ts).
//
// THE ROLE NAME IS NO LONGER DECLARED HERE. It moved to
// @fleet/domain (packages/domain/src/identity/fleet-role.ts) and is re-exported
// below so every existing importer keeps working unchanged.
//
// WHY IT MOVED. Declaring it here was correct while exactly one app needed the
// value and became untenable the moment a second did: ops-web cannot import
// from apps/api -- applications are deployable systems and must not reach into
// one another -- so a second consumer had only two options, both wrong.
// Duplicate the literal, and the SSOT quietly has two sources that drift. Cross
// the app boundary, and the dependency graph stops meaning anything. The
// accounting-department gate needs this name in BOTH the API guard and the
// ops-web session read, so the constant had to move before that feature could
// be written honestly. operator-context.ts sets the precedent in the same
// package: sole authoritative definition, consumed by every surface.
//
// THE RE-EXPORT IS DELIBERATE, not laziness. Three call sites import
// FLEET_OWNER_ROLE from this module today. Rewriting them in the same change
// would mix a relocation with a call-site migration and make the diff impossible
// to review as either. They migrate to the package import separately; until then
// this module forwards, and forwarding is not duplicating -- there is still
// exactly one declaration.
import { FLEET_OWNER_ROLE } from '@fleet/domain';

export { FLEET_OWNER_ROLE };

export type OwnerAccessDecision =
  | { readonly outcome: 'granted' }
  | { readonly outcome: 'denied' };

export function decideOwnerAccess(roles: readonly string[] | undefined): OwnerAccessDecision {
  if (roles?.includes(FLEET_OWNER_ROLE) === true) {
    return { outcome: 'granted' };
  }
  return { outcome: 'denied' };
}
