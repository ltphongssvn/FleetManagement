// apps/api/src/auth/identity-provider.interface.ts
// IIdentityProvider portability seam per Frozen Stack PDF "Auth" section.
// Corporate OIDC primary; Keycloak fallback. Concrete impls injected per env.
export interface VerifiedIdentity {
  readonly subject: string;
  readonly operatorId: string;
  readonly companyId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  // RFC 9068 step-up signals, surfaced so the fleet API can enforce acr/amr
  // assurance as defense-in-depth (see step-up.guard.ts). Absent on tokens that
  // carry no authentication-context claims (e.g. self-issued driver tokens).
  readonly acr?: string;
  readonly amr?: readonly string[];
  // Keycloak realm roles (realm_access.roles). Present on OIDC tokens;
  // absent on self-issued driver tokens. Authorizes owner-only routes.
  readonly roles?: readonly string[];
}

export interface IIdentityProvider {
  /** Verify a bearer token and return identity claims, or throw. */
  verifyToken(token: string): Promise<VerifiedIdentity>;
}

export const IDENTITY_PROVIDER = 'IDENTITY_PROVIDER' as const;
