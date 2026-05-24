// apps/api/src/auth/auth-login-policy.ts
export interface LoginCandidate {
  readonly driverId: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly operatorId: string | null;
  readonly passwordHash: string;
  readonly active: boolean;
}

export interface LoginClaims {
  readonly sub: string;
  readonly companyId: string;
  readonly businessUnitId: string;
  readonly depotId: string;
  readonly legalEntityId: string;
  readonly driverId: string;
}

export type LoginOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'invalid-password' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'missing-operator' }
  | { readonly kind: 'ok'; readonly claims: LoginClaims };

export function decideLoginOutcome(candidate: LoginCandidate | null, passwordMatches: boolean): LoginOutcome {
  if (candidate === null) return { kind: 'not-found' };
  if (!passwordMatches) return { kind: 'invalid-password' };
  if (!candidate.active) return { kind: 'disabled' };
  if (candidate.operatorId === null) return { kind: 'missing-operator' };
  return {
    kind: 'ok',
    claims: {
      sub: candidate.operatorId,
      companyId: candidate.companyId,
      businessUnitId: candidate.businessUnitId,
      depotId: candidate.depotId,
      legalEntityId: candidate.legalEntityId,
      driverId: candidate.driverId,
    },
  };
}
