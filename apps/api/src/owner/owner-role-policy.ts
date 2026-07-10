// apps/api/src/owner/owner-role-policy.ts
// Pure owner-authorization policy. The fleet API is its own trust domain: it
// does not import Keycloak realm config, it authorizes on the roles carried in
// the already-verified token (realm_access.roles, surfaced onto
// VerifiedIdentity.roles). Exact string match only - no prefix/substring - so
// a lookalike role name can never grant owner access. Kept pure and Nest-free
// so it unit-tests without the HTTP pipeline (mirrors step-up-policy.ts).
export const FLEET_OWNER_ROLE = 'fleet-owner' as const;

export type OwnerAccessDecision =
  | { readonly outcome: 'granted' }
  | { readonly outcome: 'denied' };

export function decideOwnerAccess(roles: readonly string[] | undefined): OwnerAccessDecision {
  if (roles?.includes(FLEET_OWNER_ROLE) === true) {
    return { outcome: 'granted' };
  }
  return { outcome: 'denied' };
}
